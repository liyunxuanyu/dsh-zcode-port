import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { OffPeakService } from '../src/index.js'

interface FakeAgent {
  id: string
  status: string
  session: {
    header: { cwd: string }
    append(): void
  }
  followup(): void
  whenIdle(): Promise<void>
  cancel(): void
}

/** Build a context with a fake agent registry. */
async function harness(statePath: string, opts: { agents?: FakeAgent[]; whenIdle?: () => Promise<void> } = {}) {
  const ctx = new Context()
  const created: FakeAgent[] = []
  ctx.provide('agents', {
    async create({ sessionId }: { sessionId: string }) {
      const agent: FakeAgent = {
        id: sessionId,
        status: 'idle',
        session: { header: { cwd: '/work' }, append() {} },
        followup() {},
        whenIdle: opts.whenIdle ?? (async () => {}),
        cancel() {},
      }
      created.push(agent)
      return { agent, dispose: async () => {} }
    },
    list: () => opts.agents ?? [],
    get: () => undefined,
  })
  await ctx.plugin(OffPeakService, {
    idleMinutes: 0,
    pollIntervalMs: 60_000,
    maxConcurrentTasks: 1,
    statePath,
  })
  return { ctx, service: ctx.get('offpeak') as OffPeakService, created }
}

describe('offpeak', () => {
  it('persists queued tasks and restores them as pending', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcd-offpeak-'))
    const statePath = join(dir, 'tasks.json')
    const first = await harness(statePath)
    const task = first.service.create({ prompt: 'tidy later' }, { cwd: '/work' })
    expect(first.service.list()).toHaveLength(1)
    expect(JSON.parse(readFileSync(statePath, 'utf8')).tasks[0].id).toBe(task.id)
    await first.ctx.dispose?.()

    const second = await harness(statePath)
    const restored = second.service.list()
    expect(restored).toHaveLength(1)
    expect(restored[0]?.status).toBe('pending')
    await second.ctx.dispose?.()
  })

  it('marks a task that was running at shutdown as interrupted', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcd-offpeak-'))
    const statePath = join(dir, 'tasks.json')
    const first = await harness(statePath)
    first.service.create({ prompt: 'long task' }, { cwd: '/work' })
    const [task] = first.service.list()
    // Simulate a process that died mid-run.
    const file = JSON.parse(readFileSync(statePath, 'utf8')) as { tasks: Array<Record<string, unknown>> }
    file.tasks = [{ ...file.tasks[0], status: 'running', startedAt: Date.now() }]
    writeFileSync(statePath, JSON.stringify(file))
    await first.ctx.dispose?.()

    const second = await harness(statePath)
    expect(second.service.list()[0]?.status).toBe('interrupted')
    expect(task?.id).toBeDefined()
    await second.ctx.dispose?.()
  })

  it('runs a pending task in a fresh session when idle', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcd-offpeak-'))
    const statePath = join(dir, 'tasks.json')
    const { ctx, service, created } = await harness(statePath)
    service.create({ prompt: 'do it' }, { cwd: '/work' })
    await service.tick()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(created).toHaveLength(1)
    expect(service.list()[0]?.status).toBe('succeeded')
    await ctx.dispose?.()
  })
})
