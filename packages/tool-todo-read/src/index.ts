/**
 * `todo_read` — read the calling agent's current todo list.
 *
 * dsh owns the list as the `todos` session projection fed by `todo/write`
 * snapshots (see `@deepseek-ai/dsh-tool-todo`). This consumer only reads the
 * projection; it never mutates the list.
 *
 * @module @zcd/tool-todo-read
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-tool-todo'

export const name = 'zcd-tool-todo-read'
export const inject = ['tools', 'sessionProjections']

interface TodoItemLike {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

const outputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    todos: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          content: { type: 'string', required: true },
          status: {
            type: 'string',
            required: true,
            enum: ['pending', 'in_progress', 'completed'],
          },
        },
      },
    },
    counts: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        pending: { type: 'integer', required: true },
        inProgress: { type: 'integer', required: true },
        completed: { type: 'integer', required: true },
      },
    },
  },
} as const

/**
 * Register `todo_read` on the calling context.
 * @param ctx - context carrying the tool and projection registries.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'todo_read',
    description:
      'Read the current todo list for this session. Use it to recover the plan after a long '
      + 'tool batch or before reporting progress; the list is owned by todo_write.',
    parameters: {},
    output: {
      schema: outputSchema,
      render: (_args, value) => {
        if (value.todos.length === 0) {
          return [{ type: 'text', text: 'The todo list is empty.' }]
        }
        const lines = value.todos.map(item => `- [${item.status}] ${item.content}`)
        return [{
          type: 'text',
          text: `Todo list (${value.counts.pending} pending, ${value.counts.inProgress} in progress, `
            + `${value.counts.completed} completed):\n${lines.join('\n')}`,
        }]
      },
    },
    async execute(_args, exec) {
      const agent = exec.agent
      if (agent === undefined) {
        throw new Error('todo_read requires an owning agent session')
      }
      const snapshot = ctx.sessionProjections.snapshot(agent.session, ['todos'])
      const raw = snapshot.values.todos
      const todos: TodoItemLike[] = Array.isArray(raw) ? raw as TodoItemLike[] : []
      let pending = 0
      let inProgress = 0
      let completed = 0
      for (const item of todos) {
        if (item.status === 'pending') pending++
        else if (item.status === 'in_progress') inProgress++
        else completed++
      }
      return {
        todos: todos.map(item => ({ content: item.content, status: item.status })),
        counts: { pending, inProgress, completed },
      }
    },
  }))
}
