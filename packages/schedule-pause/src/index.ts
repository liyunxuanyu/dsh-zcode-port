/**
 * Soft pause for dsh reminders.
 *
 * dsh's Schedule domain has no active/paused flag: a stored task either
 * schedules or it does not, and the only writable surfaces are create,
 * update-timing, and delete. So a real pause means *removing the row* while
 * keeping a complete snapshot, and resume means recreating it from that
 * snapshot. That is the whole design:
 *
 * - `pause(id)` reads the task from the catalog, snapshots it, deletes it.
 * - `resume(id)` recreates it through the same public `create()` path.
 * - Paused rows live in one JSON file, so a restart cannot lose them.
 *
 * Trade-off, stated plainly because it is not reversible: pausing drops the
 * task's saved delivery history along with the row. Only the rule, the
 * original binding, and the prompt survive.
 *
 * @module @zcd/schedule-pause
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ScheduleCreateRequest, ScheduleRecord } from '@deepseek-ai/dsh-schedule'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@zcd/deferred-tools'

export const name = 'zcd-schedule-pause'
export const inject = ['tools', 'deferredTools', 'schedule']

/** One paused task, enough to recreate it exactly. */
export interface PausedTask {
  /** Original task id. */
  id: string
  /** Session that owned the task. */
  sessionId: string
  /** The record as the catalog reported it. */
  record: ScheduleRecord
  /** Epoch milliseconds when it was paused. */
  pausedAt: number
}

/** On-disk shape. */
interface PausedFile {
  tasks: PausedTask[]
}

/** Resolve the paused-tasks file. */
export function resolvePausedPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.ZCD_SCHEDULE_PAUSE_HOME
  if (override !== undefined && override.trim().length > 0) return join(override, 'zcd-schedule-paused.json')
  return join(env.DSH_HOME ?? join(homedir(), '.dsh'), 'storages', 'zcd-schedule-paused.json')
}

/**
 * Translate a stored record back into a create request.
 *
 * The mapping is deliberately lossless for timing: a resumed task keeps the
 * same wall clock, cron expression, or interval it had before. A one-shot that
 * came due while paused is recreated at its original instant, so the next drive
 * delivers it (overdue) instead of silently dropping the reminder.
 *
 * @param record - record captured at pause time.
 * @returns a request accepted by `ScheduleService.create`.
 */
export function toCreateRequest(record: ScheduleRecord): ScheduleCreateRequest {
  const base = { prompt: record.prompt, title: record.title }
  switch (record.kind) {
    case 'after':
    case 'at':
      return { ...base, at: record.scheduledAt }
    case 'every':
      return { ...base, every_seconds: record.everySeconds }
    case 'daily':
      return { ...base, daily: { time: record.time, time_zone: record.timeZone } }
    case 'weekly':
      return { ...base, weekly: { time: record.time, time_zone: record.timeZone, weekdays: [...record.weekdays] } }
    case 'cron':
      return { ...base, cron: { expression: record.expression, time_zone: record.timeZone } }
    default: {
      const never: never = record
      throw new Error(`unsupported schedule kind: ${String((never as { kind?: string }).kind)}`)
    }
  }
}

/**
 * Paused-task store: one JSON file, atomic writes.
 */
export class PausedTaskStore {
  constructor(private readonly path: string = resolvePausedPath()) {}

  /** Read every paused task. */
  list(): PausedTask[] {
    if (!existsSync(this.path)) return []
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as PausedFile
      return Array.isArray(parsed.tasks) ? parsed.tasks : []
    } catch {
      return []
    }
  }

  /** Read one task by id. */
  get(id: string): PausedTask | undefined {
    return this.list().find(task => task.id === id)
  }

  /** Add or replace one task. */
  put(task: PausedTask): void {
    const tasks = this.list().filter(existing => existing.id !== task.id)
    tasks.push(task)
    this.write(tasks)
  }

  /** Remove one task, returning whether it existed. */
  remove(id: string): boolean {
    const tasks = this.list()
    const next = tasks.filter(task => task.id !== id)
    if (next.length === tasks.length) return false
    this.write(next)
    return true
  }

  /** Atomic write. */
  private write(tasks: PausedTask[]): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const temp = `${this.path}.tmp-${process.pid}-${Date.now()}`
    writeFileSync(temp, `${JSON.stringify({ tasks }, null, 2)}\n`)
    renameSync(temp, this.path)
  }
}

/** Resolve the caller's session id. */
function callerSession(exec: { agent?: { session: { id: unknown } } }): SessionId {
  const agent = exec.agent
  if (agent === undefined) throw new Error('schedule_pause requires an owning agent session')
  return agent.session.id as SessionId
}

/**
 * Register `schedule_pause` and `schedule_resume`.
 * @param ctx - context carrying tools, the deferred seam, and the schedule domain.
 */
export function apply(ctx: Context): void {
  const store = new PausedTaskStore()

  const offPause = ctx.deferredTools.register(defineTool({
    name: 'schedule_pause',
    description:
      'Pause one reminder by id so it stops firing until resumed. The task is removed from dsh '
      + 'and kept as a snapshot in ZCD storage; resuming recreates it with the same rule. '
      + 'Its saved delivery history is dropped — that is the cost of a real pause.',
    parameters: {
      id: { type: 'string', required: true, description: 'Schedule id from schedule_list or the catalog.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          title: { type: 'string', required: true },
          kind: { type: 'string', required: true },
          paused: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.paused
          ? `Paused ${value.id} (${value.kind}): ${value.title}`
          : `${value.id} is already paused.`,
      }],
    },
    async execute(args, exec) {
      const existing = store.get(args.id)
      if (existing !== undefined) {
        return { id: existing.id, title: existing.record.title, kind: existing.record.kind, paused: false }
      }
      const sessionId = callerSession(exec)
      const entries = await ctx.schedule.catalog()
      const entry = entries.find(item => String(item.id) === args.id)
      if (entry === undefined) throw new Error(`schedule ${args.id} does not exist`)
      if (entry.status !== 'active') {
        throw new Error(`schedule ${args.id} is already inactive in dsh; nothing to pause`)
      }
      if (String(entry.sessionId) !== String(sessionId)) {
        throw new Error(`schedule ${args.id} belongs to another session; pause it from that session`)
      }
      store.put({ id: args.id, sessionId: String(entry.sessionId), record: entry, pausedAt: Date.now() })
      const removed = await ctx.schedule.delete({ sessionId, id: entry.id })
      if (!removed.deleted) {
        store.remove(args.id)
        throw new Error(`schedule ${args.id} could not be removed: ${removed.code}`)
      }
      return { id: args.id, title: entry.title, kind: entry.kind, paused: true }
    },
  }), { group: 'schedule', keywords: ['pause', 'hold', 'suspend', 'reminder'] })

  const offResume = ctx.deferredTools.register(defineTool({
    name: 'schedule_resume',
    description:
      'Resume a paused reminder by id: recreate it from the ZCD snapshot with its original rule '
      + '(absolute time, interval, daily/weekly time, or cron expression) in its original session.',
    parameters: {
      id: { type: 'string', required: true, description: 'Schedule id of a paused task.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          title: { type: 'string', required: true },
          kind: { type: 'string', required: true },
          resumed: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.resumed
          ? `Resumed ${value.id} (${value.kind}): ${value.title}`
          : `${value.id} is not paused.`,
      }],
    },
    async execute(args) {
      const paused = store.get(args.id)
      if (paused === undefined) {
        return { id: args.id, title: '', kind: '', resumed: false }
      }
      const created = await ctx.schedule.create(paused.sessionId as SessionId, toCreateRequest(paused.record))
      store.remove(paused.id)
      return { id: String(created.id), title: created.title, kind: created.kind, resumed: true }
    },
  }), { group: 'schedule', keywords: ['resume', 'unpause', 'restore', 'reminder'] })

  const offList = ctx.deferredTools.register(defineTool({
    name: 'schedule_paused',
    description: 'List reminders held by schedule_pause, with their rule and the time they were paused.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tasks: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                title: { type: 'string', required: true },
                kind: { type: 'string', required: true },
                pausedAt: { type: 'integer', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.tasks.length === 0
          ? 'No paused reminders.'
          : value.tasks.map(task => `${task.id} [${task.kind}] ${task.title}`).join(String.fromCharCode(10)),
      }],
    },
    async execute() {
      return {
        tasks: store.list().map(task => ({
          id: task.id,
          title: task.record.title,
          kind: task.record.kind,
          pausedAt: task.pausedAt,
        })),
      }
    },
  }), { group: 'schedule', keywords: ['paused', 'held', 'reminders', 'list'] })

  ctx.effect(() => () => {
    offPause()
    offResume()
    offList()
  }, 'zcd-schedule-pause: deferred registrations')
}
