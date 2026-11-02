/**
 * Memory tools: search, read, write, remove.
 *
 * All four are deferred. Writes are restricted to the memory directory by the
 * service; the tool adds no path input, so a model cannot point it elsewhere.
 *
 * @module @zcd/tool-memory
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@zcd/deferred-tools'
import type {} from '@zcd/memory'

export const name = 'zcd-tool-memory'
export const inject = ['tools', 'deferredTools', 'memory']

const entrySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    scope: { type: 'string', required: true, enum: ['project', 'user'] },
    name: { type: 'string', required: true },
    description: { type: 'string', required: true },
    type: { type: 'string', required: true, enum: ['fact', 'preference', 'decision', 'reference'] },
    body: { type: 'string', required: true },
    updatedAt: { type: 'integer', required: true },
  },
} as const

/**
 * Register the four memory tools through the deferred seam.
 * @param ctx - context carrying tools, the seam, and the memory service.
 */
export function apply(ctx: Context): void {
  const offSearch = ctx.deferredTools.register(defineTool({
    name: 'memory_search',
    description:
      'Search long-term memory (project and user scopes) for a literal query. Use it before '
      + 'asking the user to repeat a preference, decision, or fact from earlier work.',
    parameters: {
      query: { type: 'string', required: true, description: 'Literal text to find.' },
      scope: { type: 'string', enum: ['project', 'user', 'both'], description: 'Default both.' },
      limit: { type: 'integer', description: 'Maximum entries (default 5).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { entries: { type: 'array', required: true, items: entrySchema } },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.entries.length === 0
          ? 'No memory entry matched.'
          : value.entries.map(entry =>
            `- [${entry.scope}] ${entry.name} (${entry.id}): ${entry.description}`).join('\n'),
      }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('memory_search requires an owning agent session')
      const cwd = agent.session.header.cwd
      const scopes = args.scope === 'project' ? ['project' as const]
        : args.scope === 'user' ? ['user' as const]
          : ['project' as const, 'user' as const]
      const entries = ctx.memory.search(args.query, {
        scopes,
        ...(cwd === undefined ? {} : { cwd }),
        limit: Math.max(1, Math.min(20, args.limit ?? 5)),
      })
      return { entries }
    },
  }), { group: 'memory', keywords: ['remember', 'preference', 'decision', 'notes'] })

  const offRead = ctx.deferredTools.register(defineTool({
    name: 'memory_read',
    description: 'Read one memory entry by id.',
    parameters: {
      id: { type: 'string', required: true, description: 'Entry id from memory_search.' },
      scope: { type: 'string', required: true, enum: ['project', 'user'] },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { entry: { ...entrySchema, required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `# ${value.entry.name}\n\n${value.entry.body}` }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('memory_read requires an owning agent session')
      const entry = ctx.memory.read(args.id, args.scope, agent.session.header.cwd)
      if (entry === undefined) throw new Error(`memory entry ${args.id} does not exist`)
      return { entry }
    },
  }), { group: 'memory', keywords: ['read', 'entry', 'recall'] })

  const offWrite = ctx.deferredTools.register(defineTool({
    name: 'memory_write',
    description:
      'Write one durable memory entry. Use it for a user preference, a project decision, or a '
      + 'fact that will matter in later sessions. Do not store credentials; store a reference.',
    parameters: {
      scope: { type: 'string', required: true, enum: ['project', 'user'] },
      name: { type: 'string', required: true, description: 'Short title; same name replaces.' },
      description: { type: 'string', required: true, description: 'One-line summary for the index.' },
      type: { type: 'string', required: true, enum: ['fact', 'preference', 'decision', 'reference'] },
      body: { type: 'string', required: true, description: 'The memory itself, Markdown.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { entry: { ...entrySchema, required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `Stored ${value.entry.id} (${value.entry.scope}).` }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('memory_write requires an owning agent session')
      const entry = ctx.memory.write({
        scope: args.scope,
        name: args.name,
        description: args.description,
        type: args.type,
        body: args.body,
      }, { cwd: agent.session.header.cwd })
      return { entry }
    },
  }), { group: 'memory', keywords: ['remember', 'store', 'save'] })

  const offRemove = ctx.deferredTools.register(defineTool({
    name: 'memory_remove',
    description: 'Soft-delete one memory entry. The file moves to .trash for seven days.',
    parameters: {
      id: { type: 'string', required: true },
      scope: { type: 'string', required: true, enum: ['project', 'user'] },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { removed: { type: 'boolean', required: true }, id: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `Removed ${value.id}.` }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('memory_remove requires an owning agent session')
      ctx.memory.remove(args.id, args.scope, agent.session.header.cwd)
      return { removed: true, id: args.id }
    },
  }), { group: 'memory', keywords: ['delete', 'forget', 'remove'] })

  ctx.effect(() => () => {
    offSearch()
    offRead()
    offWrite()
    offRemove()
  }, 'zcd-tool-memory: deferred registrations')
}
