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
  /** Whether a bash command must pass the read-only classifier. */
  classifyBash?: boolean
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
 * Install the plan-mode policy listener.
 * @param ctx - plugin context.
 * @param config - optional policy overrides.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const denied = new Set(config.deniedTools ?? DEFAULT_DENIED)
  const classifyBash = config.classifyBash ?? true
  ctx.on('tools/pre-execute', async (
    exec: ToolExecution,
    next: () => Promise<PreToolDecision>,
  ): Promise<PreToolDecision> => {
    const decision = await next()
    if (decision.kind !== 'allow') return decision
    if (!planActive(ctx, exec)) return decision
    if (denied.has(exec.name)) {
      return {
        kind: 'deny',
        reason: `Plan mode allows read-only work only; "${exec.name}" can mutate state. `
          + 'Finish the plan and exit plan mode before changing files.',
      }
    }
    if (classifyBash && exec.name === 'bash') {
      const command = bashCommand(exec.arguments)
      if (command === undefined) {
        return { kind: 'deny', reason: 'Plan mode requires an analysable bash command.' }
      }
      const verdict = classifyCommand(command)
      if (verdict.kind !== 'read-only') {
        return {
          kind: 'deny',
          reason: `Plan mode denied this bash command: ${verdict.reason}. `
            + 'Use read-only commands, or exit plan mode to run it.',
        }
      }
    }
    return decision
  }, { prepend: true })
}
