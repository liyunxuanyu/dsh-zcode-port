/**
 * `tool_search` — find and load a deferred tool.
 *
 * The catalog is owned by `ctx.deferredTools`: each tool registers itself with
 * a group and keywords, and the seam keeps it out of model steps until the
 * owning session loads it. This plugin adds only the model-facing search
 * surface and the durable load event.
 *
 * @module @zcd/tool-search
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@zcd/deferred-tools'
import { rankEntries } from './score.js'

export const name = 'zcd-tool-search'
export const inject = ['tools', 'deferredTools']

/** Deployment configuration. */
export interface Config {
  /** Maximum matches per call. */
  maxResults: number
}

const outputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    matches: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          group: { type: 'string', required: true },
          description: { type: 'string', required: true },
        },
      },
    },
    pending: { type: 'integer', required: true },
  },
} as const

/**
 * Register the `tool_search` tool.
 * @param ctx - context carrying the tool registry and the deferred seam.
 * @param config - deployment limits.
 */
export function apply(ctx: Context, config: Config): void {
  const maxResults = Math.max(1, Math.min(25, config.maxResults))

  ctx.tools.register(defineTool({
    name: 'tool_search',
    description:
      'Search the deferred tool catalog and load a tool for the next step. Call this when you '
      + 'need a capability that is not in your current tool list. After loading, call the tool by '
      + 'its exact name in your NEXT step; it is not callable in the same step. Loaded tools stay '
      + 'available for this session.',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'What you need to do, or the tool name. Keywords work better than full sentences.',
      },
    },
    output: {
      schema: outputSchema,
      render: (_args, value) => {
        if (value.matches.length === 0) {
          return [{
            type: 'text',
            text: value.pending === 0
              ? 'No deferred tools are registered in this deployment.'
              : `No match among ${value.pending} deferred tools. Try a broader query or a different term.`,
          }]
        }
        const lines = value.matches.map(match =>
          `- ${match.name} [${match.group}]: ${match.description}`)
        return [{
          type: 'text',
          text: `Loaded for the next step:\n${lines.join('\n')}`,
        }]
      },
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) {
        throw new Error('tool_search requires an owning agent session')
      }
      const entries = ctx.deferredTools.entries(agent).filter(entry => !entry.loaded)
      const matches = rankEntries(entries, args.query, maxResults)
      for (const match of matches) {
        ctx.deferredTools.markLoaded(agent.session, match.entry.name, args.query)
      }
      return {
        matches: matches.map(match => ({
          name: match.entry.name,
          group: match.entry.group,
          description: match.entry.description,
        })),
        pending: entries.length,
      }
    },
  }))
}
