/**
 * Strict plan mode: while the session's plan projection is active, deny tools
 * that can mutate files or run mutating shell commands. Read-only tools stay
 * available, which is what makes plan mode useful for exploration.
 *
 * dsh's own plan mode deliberately keeps every tool available and relies on
 * sandbox/approval policy. This plugin is the ZCode-style optional hardening:
 * it is a policy layer on top, never a replacement for the sandbox, and it
 * never widens anything.
 *
 * @module @zcd/policy-plan-readonly
 */

import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-plan-mode'
import type {} from '@zcd/runtime-settings'
import { classifyCommand } from './classify.js'

export const name = 'zcd-policy-plan-readonly'
export const inject = ['tools', 'sessionProjections']

/** Deployment configuration. */
export interface Config {
  /**
   * Tools denied while planning. Defaults cover file mutation and arbitrary
   * shell/terminal input; read-only tools are never denied.
   */
  deniedTools?: string[]
  /** Whether a bash command must pass the read-only classifier when no setting overrides it. */
  classifyBash?: boolean
  /**
   * Whether the policy starts enabled when the settings file has no opinion.
   * Defaults to false so the shipped behaviour matches dsh; the settings page
   * is the switch that turns strict plan mode on.
   */
  enabled?: boolean
}

/** Tools that always mutate, independent of arguments. */
const DEFAULT_DENIED = [
  'write',
  'edit',
  'apply_patch',
  'str_replace_editor',
  'terminal_send',
] as const

interface PlanView {
  active: boolean
  pending: boolean
}

/**
 * Whether the session is currently in plan mode.
 * @param ctx - context carrying the projection registry.
 * @param exec - candidate execution.
 * @returns true when the plan projection reports an active plan.
 */
function planActive(ctx: Context, exec: ToolExecution): boolean {
  const agent = exec.agent
  if (agent === undefined) return false
  const snapshot = ctx.sessionProjections.snapshot(agent.session, ['plan'])
  const plan = snapshot.values.plan as PlanView | undefined
  return plan?.active === true
}

/**
 * Read the `command` argument of a bash call without trusting its shape.
 * @param args - raw tool arguments.
 * @returns the command string, or undefined when absent/not a string.
 */
function bashCommand(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined
  const command = (args as { command?: unknown }).command
  return typeof command === 'string' ? command : undefined
}

/**
 * Pure policy decision for one allowed call.
 *
 * @param input - plan state, tool name, parsed command, and policy switches.
 * @returns a denial when the call must be refused, otherwise undefined.
 */
export function decidePlanMode(input: {
  active: boolean
  toolName: string
  command?: string
  denied: ReadonlySet<string>
  classifyBash: boolean
}): { kind: 'deny'; reason: string } | undefined {
  if (!input.active) return undefined
  if (input.denied.has(input.toolName)) {
    return {
      kind: 'deny',
      reason: `Plan mode allows read-only work only; "${input.toolName}" can mutate state. `
        + 'Finish the plan and exit plan mode before changing files.',
    }
  }
  if (!input.classifyBash || input.toolName !== 'bash') return undefined
  if (input.command === undefined) {
    return { kind: 'deny', reason: 'Plan mode requires an analysable bash command.' }
  }
  const verdict = classifyCommand(input.command)
  if (verdict.kind === 'read-only') return undefined
  return {
    kind: 'deny',
    reason: `Plan mode denied this bash command: ${verdict.reason}. `
      + 'Use read-only commands, or exit plan mode to run it.',
  }
}

/**
 * Install the plan-mode policy listener.
 * @param ctx - plugin context.
 * @param config - optional policy overrides.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const denied = new Set(config.deniedTools ?? DEFAULT_DENIED)
  ctx.on('tools/pre-execute', async (
    exec: ToolExecution,
    next: () => Promise<PreToolDecision>,
  ): Promise<PreToolDecision> => {
    const decision = await next()
    if (decision.kind !== 'allow') return decision
    // Read the switch per call: the settings page flips it without a restart,
    // and an absent service falls back to the composition config.
    const settings = ctx.get('runtimeSettings')
    const enabled = settings?.get('policy.planReadonly.enabled') ?? config.enabled ?? false
    if (!enabled) return decision
    const classifyBash = settings?.get('policy.planReadonly.classifyBash') ?? config.classifyBash ?? true
    return decidePlanMode({
      active: planActive(ctx, exec),
      toolName: exec.name,
      ...(bashCommand(exec.arguments) === undefined ? {} : { command: bashCommand(exec.arguments) }),
      denied,
      classifyBash,
    }) ?? decision
  }, { prepend: true })
}
