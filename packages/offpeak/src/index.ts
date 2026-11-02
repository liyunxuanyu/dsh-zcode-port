/**
 * `ctx.offpeak` — defer a prompt until the workspace is idle.
 *
 * The service owns task state and the idle gate; it creates a fresh session
 * for each run and yields immediately when a human sends input in the same
 * workspace. It never changes sandbox, approval, or model policy: the task's
 * session is an ordinary session with an ordinary preset.
 *
 * @module @zcd/offpeak
 */

import { randomUUID } from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@zcd/shared/events'
import { z as zod } from 'zod'
import type { OffPeakTask, OffPeakTaskInput } from './types.js'

export type * from './types.js'

/** Deployment configuration. */
export interface Config {
  /** Idle minutes required before a task may start. */
  idleMinutes: number
  /** Poll interval for the idle gate. */
  pollIntervalMs: number
  /** Maximum tasks running at once across the process. */
  maxConcurrentTasks: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    offpeak: OffPeakService
  }
}

interface StoredTask extends OffPeakTask {
  readonly cwd: string
}

/**
 * Off-peak scheduler.
 */
export class OffPeakService extends Service {
  static inject = ['agents']

  private readonly tasks = new Map<string, StoredTask>()
  private timer: ReturnType<typeof setInterval> | undefined
  private lastActivityAt = Date.now()
  private running = 0

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'offpeak')
  }

  protected [Service.init](): void {
    this.timer = setInterval(() => { void this.tick() }, this.config.pollIntervalMs)
    this.ctx.effect(() => () => {
      if (this.timer !== undefined) clearInterval(this.timer)
      this.timer = undefined
    }, 'zcd-offpeak: stop scheduler')
    // Any user message in any live session is activity; it also yields a
    // running task in the same workspace.
    this.ctx.on('session/event', (session, event) => {
      if (event.type !== 'user/message') return
      if (event.data.source.kind !== 'user') return
      this.lastActivityAt = Date.now()
      if (session.header.cwd !== undefined) this.yieldTasksFor(session.header.cwd)
    })
  }

  /**
   * Queue one task.
   * @param input - prompt and scheduling hints.
   * @param opts - creating session, used for the default cwd.
   * @returns the queued task.
   */
  create(input: OffPeakTaskInput, opts: { cwd: string }): OffPeakTask {
    if (input.prompt.trim() === '') throw new Error('offpeak prompt must not be empty')
    const id = `offpeak-${randomUUID()}`
    const task: StoredTask = {
      id,
      status: 'pending',
      input,
      createdAt: Date.now(),
      cwd: input.cwd ?? opts.cwd,
    }
    this.tasks.set(id, task)
    return task
  }

  /**
   * List tasks, newest first.
   * @param filter - optional status filter.
   * @returns tasks.
   */
  list(filter?: { status?: OffPeakTask['status'] }): OffPeakTask[] {
    const all = [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt)
    return filter?.status === undefined ? all : all.filter(task => task.status === filter.status)
  }

  /**
   * Cancel one pending or running task.
   * @param id - task id.
   * @param reason - recorded in the summary.
   */
  cancel(id: string, reason = 'cancelled by request'): void {
    const task = this.tasks.get(id)
    if (task === undefined) throw new Error(`unknown offpeak task ${id}`)
    if (task.status !== 'pending' && task.status !== 'running') return
    if (task.sessionId !== undefined) {
      this.ctx.agents.get(task.sessionId as SessionId)?.cancel({ kind: 'user' })
    }
    this.tasks.set(id, { ...task, status: 'cancelled', endedAt: Date.now(), summary: reason })
  }

  /**
   * Mark every task in one workspace as taken over.
   * @param cwd - workspace directory.
   */
  private yieldTasksFor(cwd: string): void {
    for (const [id, task] of this.tasks) {
      if (task.cwd !== cwd) continue
      if (task.status !== 'running') continue
      if (task.sessionId !== undefined) {
        this.ctx.agents.get(task.sessionId as SessionId)?.cancel({ kind: 'user' })
      }
      this.tasks.set(id, {
        ...task,
        status: 'taken-over',
        endedAt: Date.now(),
        summary: 'a user message arrived in this workspace',
      })
    }
  }

  /**
   * One scheduler tick: start a task when the gate is open.
   */
  async tick(): Promise<void> {
    if (this.running >= this.config.maxConcurrentTasks) return
    const idleFor = Date.now() - this.lastActivityAt
    if (idleFor < this.config.idleMinutes * 60_000) return
    const pending = [...this.tasks.values()].find(task => task.status === 'pending')
    if (pending === undefined) return
    if (this.workspaceBusy(pending.cwd)) return
    this.running++
    void this.runTask(pending).finally(() => { this.running-- })
  }

  /**
   * Whether any live agent in the workspace is inside a turn.
   * @param cwd - workspace directory.
   * @returns true when work is in flight.
   */
  private workspaceBusy(cwd: string): boolean {
    for (const agent of this.ctx.agents.list()) {
      if (agent.session.header.cwd !== cwd) continue
      if (agent.status === 'idle') continue
      return true
    }
    return false
  }

  /**
   * Execute one task in a fresh session.
   * @param task - the task to run.
   */
  private async runTask(task: StoredTask): Promise<void> {
    const sessionId = `session-${randomUUID()}` as SessionId
    this.tasks.set(task.id, { ...task, status: 'running', startedAt: Date.now() })
    try {
      const selection = this.ctx.get('agentDefaultModel')?.currentSelection()
      const handle = await this.ctx.agents.create({
        sessionId,
        meta: { cwd: task.cwd },
        ...(selection === undefined ? {} : { agentOptions: selection }),
      })
      const agent = handle.agent
      this.tasks.set(task.id, { ...this.tasks.get(task.id)!, sessionId })
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: task.input.prompt }],
        source: { kind: 'user' },
      }))
      await agent.whenIdle()
      await handle.dispose()
      this.tasks.set(task.id, {
        ...this.tasks.get(task.id)!,
        status: 'succeeded',
        endedAt: Date.now(),
        summary: 'task completed',
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.tasks.set(task.id, {
        ...this.tasks.get(task.id)!,
        status: 'failed',
        endedAt: Date.now(),
        error: { code: 'OFFPEAK_RUN_FAILED', message },
      })
    }
  }
}

export default OffPeakService

/** Runtime schema for the service config. */
export const ConfigSchema = zod.object({
  idleMinutes: zod.number().int().positive().default(10),
  pollIntervalMs: zod.number().int().positive().default(30_000),
  maxConcurrentTasks: zod.number().int().positive().default(2),
})
