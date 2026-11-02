/**
 * Workflow authoring skill gate.
 *
 * ZCode refuses workflow authoring tools until the session has loaded the
 * `dynamic-workflows` skill; the rules live in the skill, so running the tool
 * without reading them is a contract violation. This plugin ports that gate to
 * dsh: `workflow_run` and a script-changing `workflow_amend` are denied until a
 * successful `skill({ name: "dynamic-workflows" })` call is visible in the
 * session log. Running a saved/unchanged script stays exempt.
 *
 * The gate reads the durable event log, not a session flag. A compaction closes
 * the gate again because the skill text left the model-visible history; the
 * model must reload it, exactly like a read-file state after context collapse.
 *
 * @module @zcd/policy-skill-gate
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-compaction'
import type {} from '@deepseek-ai/dsh-session-query'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

export const name = 'zcd-policy-skill-gate'
export const inject = ['tools', 'sessionQuery']

/** Deployment configuration. */
export interface Config {
  /** Skills that open the gate. Defaults to `dynamic-workflows`. */
  skills?: string[]
  /** Authoring tools that require one of the skills. */
  gatedTools?: string[]
}

const DEFAULT_SKILLS = ['dynamic-workflows'] as const
const DEFAULT_GATED = ['workflow_run', 'workflow_amend'] as const

/** Parse the `name` argument of a `skill` call without trusting its shape. */
function skillArgument(raw: string): string | undefined {
  try {
    const value = JSON.parse(raw) as { name?: unknown }
    return typeof value.name === 'string' ? value.name : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether a skill has a completed, non-error `skill` call in the current log.
 *
 * Compaction clears the result: the summary replaced the skill body, so the
 * gate closes until the model reloads the skill.
 *
 * @param events - ordered session events.
 * @param skill - exact skill name.
 * @returns true when the skill was loaded most recently and not compacted away.
 */
export function hasLoadedSkill(events: readonly SessionEvent[], skill: string): boolean {
  const calls = new Map<string, string>()
  const loaded = new Set<string>()
  for (const event of events) {
    if (event.type === 'compaction/end') {
      calls.clear()
      loaded.clear()
      continue
    }
    if (event.type === 'tool/call' && event.data.name === 'skill') {
      const name = skillArgument(event.data.arguments)
      if (name !== undefined) calls.set(event.data.callId, name)
      continue
    }
    if (event.type === 'tool/result') {
      const message = event.data.message
      const called = calls.get(message.toolCallId)
      if (called !== undefined && message.isError !== true) loaded.add(called)
    }
  }
  return loaded.has(skill)
}

/**
 * Whether one call must pass the gate.
 *
 * `workflow_amend` that only renames a run is not authoring, so it stays open
 * even without the skill; a new script closes the exemption.
 *
 * @param toolName - tool being executed.
 * @param args - raw arguments.
 * @param gated - configured gated tools.
 * @returns true when the skill must be loaded first.
 */
export function isGatedCall(
  toolName: string,
  args: unknown,
  gated: ReadonlySet<string> = new Set(DEFAULT_GATED),
): boolean {
  if (!gated.has(toolName)) return false
  if (toolName === 'workflow_amend') {
    const script = typeof args === 'object' && args !== null
      ? (args as { script?: unknown }).script
      : undefined
    return typeof script === 'string' && script.trim().length > 0
  }
  return true
}

/**
 * Install the gate.
 * @param ctx - context carrying tools and session history.
 * @param config - optional skill/tool overrides.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const skills = config.skills ?? [...DEFAULT_SKILLS]
  const gated = new Set(config.gatedTools ?? DEFAULT_GATED)

  ctx.on('tools/pre-execute', async (
    exec: ToolExecution,
    next: () => Promise<PreToolDecision>,
  ): Promise<PreToolDecision> => {
    if (!isGatedCall(exec.name, exec.arguments, gated)) return next()
    const agent = exec.agent
    if (agent === undefined) return next()
    let loaded = false
    try {
      const snapshot = await ctx.sessionQuery.readSession(agent.session.id)
      loaded = skills.some(skill => hasLoadedSkill(snapshot.events, skill))
    } catch {
      // History is unavailable: do not block on infrastructure failure.
      return next()
    }
    if (loaded) return next()
    return {
      kind: 'deny',
      reason: `Load the ${skills[0] ?? 'dynamic-workflows'} skill before authoring a workflow: `
        + `call skill({ name: "${skills[0] ?? 'dynamic-workflows'}" }), read it, then call `
        + `${exec.name} again. Running an unchanged script does not need the gate.`,
    }
  }, { prepend: true })
}
