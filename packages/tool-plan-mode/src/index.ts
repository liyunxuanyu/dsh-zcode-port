/**
 * `enter_plan_mode` — the tool-shaped entry into dsh's plan mode.
 *
 * dsh exposes plan mode as the `/plan` command and the model-facing
 * `exit_plan_mode` tool. ZCode exposes both directions as tools, which lets a
 * model decide to plan without a human typing a slash command. This consumer
 * drives the existing command registry; it does not own plan state.
 *
 * @module @zcd/tool-plan-mode
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-commands'

export const name = 'zcd-tool-plan-mode'
export const inject = ['tools', 'commands']

const outputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    entered: { type: 'boolean', required: true },
    message: { type: 'string', required: true },
  },
} as const

/**
 * Register `enter_plan_mode`.
 * @param ctx - context carrying the tool and command registries.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'enter_plan_mode',
    description:
      'Switch this session into plan mode before implementing a non-trivial change. In plan mode, '
      + 'explore and design first, then call exit_plan_mode with the complete plan for approval. '
      + 'Use this when the user asks for a plan, or when you need agreement on approach before editing.',
    parameters: {},
    output: {
      schema: outputSchema,
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(_args, exec) {
      const agent = exec.agent
      if (agent === undefined) {
        throw new Error('enter_plan_mode requires an owning agent session')
      }
      const execution = await ctx.commands.execute(agent, '/plan', [], exec.signal)
      if (execution === undefined) {
        throw new Error('plan mode is unavailable: the /plan command is not composed')
      }
      if (execution.result.kind !== 'success') {
        throw new Error(execution.result.text ?? 'the /plan command rejected the request')
      }
      return {
        entered: true,
        message: 'Entered plan mode. Explore and design, then call exit_plan_mode with the complete plan.',
      }
    },
  }))
}
