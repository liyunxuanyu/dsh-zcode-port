/**
 * Off-peak tools: queue, inspect, and cancel deferred work.
 *
 * All three are deferred: they are rare, and their schemas should not cost a
 * slot in every request. `tool_search` loads them by name or intent.
 *
 * @module @zcd/tool-offpeak
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@zcd/deferred-tools'
import type {} from '@zcd/offpeak'

export const name = 'zcd-tool-offpeak'
export const inject = ['tools', 'deferredTools', 'offpeak']

const taskSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    status: {
      type: 'string',
      required: true,
      enum: ['pending', 'running', 'succeeded', 'failed', 'cancelled', 'taken-over', 'interrupted'],
    },
    title: { type: 'string' },
    sessionId: { type: 'string' },
  },
} as const

/**
 * Register the off-peak tools.
 * @param ctx - context carrying tools, the deferred seam, and the scheduler.
 */
export function apply(ctx: Context): void {
  const offCreate = ctx.deferredTools.register(defineTool({
    name: 'offpeak_create',
    description:
      'Queue a prompt to run when this workspace is idle. Use it for maintenance work the user '
      + 'wants done later (cleanup, reports, verification) without blocking the current turn. '
      + 'The task runs in a fresh session and yields if the user sends input in this workspace.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Complete instruction for the deferred task.' },
      title: { type: 'string', description: 'Short label for lists.' },
      idle_minutes: { type: 'integer', description: 'Idle minutes required before starting (default 10).' },
    },
    output: {
      schema: taskSchema,
      render: (_args, value) => [{ type: 'text', text: `Queued ${value.id} (${value.status}).` }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('offpeak_create requires an owning agent session')
      const cwd = agent.session.header.cwd ?? process.cwd()
      const task = ctx.offpeak.create({
        prompt: args.prompt,
        ...(args.title === undefined ? {} : { title: args.title }),
        ...(args.idle_minutes === undefined ? {} : { idleMinutes: args.idle_minutes }),
        cwd,
      }, { cwd })
      return {
        id: task.id,
        status: task.status,
        ...(task.input.title === undefined ? {} : { title: task.input.title }),
      }
    },
  }), { group: 'scheduling', keywords: ['later', 'idle', 'defer', 'background'] })

  const offList = ctx.deferredTools.register(defineTool({
    name: 'offpeak_list',
    description: 'List off-peak tasks and their statuses.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tasks: { type: 'array', required: true, items: taskSchema },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.tasks.length === 0
          ? 'No off-peak tasks.'
          : value.tasks.map(task => `- ${task.id} [${task.status}]${task.title ? ` ${task.title}` : ''}`).join('\n'),
      }],
    },
    async execute() {
      return {
        tasks: ctx.offpeak.list().map(task => ({
          id: task.id,
          status: task.status,
          ...(task.input.title === undefined ? {} : { title: task.input.title }),
          ...(task.sessionId === undefined ? {} : { sessionId: task.sessionId }),
        })),
      }
    },
  }), { group: 'scheduling', keywords: ['offpeak', 'tasks', 'queue'] })

  const offCancel = ctx.deferredTools.register(defineTool({
    name: 'offpeak_cancel',
    description: 'Cancel one pending or running off-peak task.',
    parameters: {
      id: { type: 'string', required: true, description: 'Task id from offpeak_list.' },
    },
    output: {
      schema: taskSchema,
      render: (_args, value) => [{ type: 'text', text: `Cancelled ${value.id} (${value.status}).` }],
    },
    async execute(args) {
      ctx.offpeak.cancel(args.id)
      const task = ctx.offpeak.list().find(item => item.id === args.id)
      if (task === undefined) throw new Error(`unknown offpeak task ${args.id}`)
      return {
        id: task.id,
        status: task.status,
        ...(task.input.title === undefined ? {} : { title: task.input.title }),
      }
    },
  }), { group: 'scheduling', keywords: ['offpeak', 'cancel', 'stop'] })

  ctx.effect(() => () => { offCreate(); offList(); offCancel() }, 'zcd-tool-offpeak: deferred registrations')
}
