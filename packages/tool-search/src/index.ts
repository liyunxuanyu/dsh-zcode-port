/**
 * `tool_search` — load a deferred tool by name or intent.
 *
 * The mechanism relies on dsh's per-step tool admission: every tool is
 * registered, and a step sees only the definitions its `resolve()` admits.
 * This plugin owns the "loaded" set as a session projection, so a load
 * survives resume and fork. The actual deferred registrations belong to the
 * plugin that owns the tool; this package supplies the search surface.
 *
 * @module @zcd/tool-search
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-session-projection'
import { z as zod } from 'zod'
import '@zcd/shared/events'
import { rankEntries, type CatalogEntry } from './score.js'

export const name = 'zcd-tool-search'
export const inject = ['tools', 'sessionProjections']

/** Deployment configuration. */
export interface Config {
  /** Tool names that participate in search. Empty means no catalog. */
  deferred: string[]
  /** Optional display group per tool name. */
  groups?: Record<string, string>
  /** Maximum matches per call. */
  maxResults: number
}

/** Projection key holding the names this session has loaded. */
const LOADED_KEY = 'zcdDeferredTools'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Deferred tool names admitted for the owning session. */
    zcdDeferredTools: string[]
  }
}

const loadedSchema = zod.array(zod.string())

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
          alreadyLoaded: { type: 'boolean', required: true },
        },
      },
    },
    total: { type: 'integer', required: true },
  },
} as const

/** Default group label when the deployment supplies none. */
const DEFAULT_GROUP = 'general'

/**
 * Register the projection and the `tool_search` tool.
 * @param ctx - context carrying the tool and projection registries.
 * @param config - deployment catalog configuration.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const deferred = new Set(config.deferred)
  const groups = config.groups ?? {}
  const maxResults = Math.max(1, Math.min(25, config.maxResults))
  const tools = ctx.tools

  await ctx.sessionProjections.register<'zcdDeferredTools', string[]>({
    key: LOADED_KEY,
    stateSchema: loadedSchema,
    init: () => [],
    apply: (state, event) => {
      if (event.type !== 'deferred-tool/loaded') return state
      const next = event.data.name
      if (state.includes(next)) return state
      return [...state, next]
    },
    wire: { viewSchema: loadedSchema, view: state => state, summary: false },
    stateVersion: 1,
  })

  tools.register(defineTool({
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
            text: 'No deferred tool matched. Try a broader query, or use a tool already in your list.',
          }]
        }
        const lines = value.matches.map(match =>
          `- ${match.name} [${match.group}]${match.alreadyLoaded ? ' (already loaded)' : ''}: ${match.description}`)
        return [{
          type: 'text',
          text: `Loaded for the next step (${value.matches.length}/${value.total} matches):\n${lines.join('\n')}`,
        }]
      },
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) {
        throw new Error('tool_search requires an owning agent session')
      }
      const snapshot = ctx.sessionProjections.snapshot(agent.session, [LOADED_KEY])
      const loaded = new Set(snapshot.values.zcdDeferredTools ?? [])
      const definitions = tools.definitions(agent)
      const entries: CatalogEntry[] = []
      const alreadyLoaded = new Set<string>()
      for (const definition of definitions) {
        if (!deferred.has(definition.name)) continue
        if (loaded.has(definition.name)) {
          alreadyLoaded.add(definition.name)
          continue
        }
        entries.push({
          name: definition.name,
          group: groups[definition.name] ?? DEFAULT_GROUP,
          description: definition.description ?? '',
          keywords: [definition.name.replaceAll('_', ' ')],
        })
      }
      const matches = rankEntries(entries, args.query, maxResults)
      for (const match of matches) {
        agent.session.append('deferred-tool/loaded', {
          name: match.entry.name,
          query: args.query,
          at: Date.now(),
        })
      }
      return {
        matches: matches.map(match => ({
          name: match.entry.name,
          group: match.entry.group,
          description: match.entry.description,
          alreadyLoaded: alreadyLoaded.has(match.entry.name),
        })),
        total: entries.length,
      }
    },
  }))
}
