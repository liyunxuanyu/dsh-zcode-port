import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { DurableWorkflowService } from '../src/index.js'

/** Build a context whose child agent emits one assistant message and goes idle. */
async function harness() {
  const ctx = new Context()
  const created: string[] = []
  ctx.provide('agents', {
    async create({ sessionId }: { sessionId: string }) {
      created.push(sessionId)
      const session = {
        id: sessionId,
        header: { cwd: '/work', origin: 'subagent' as const },
      }
      let resolveIdle: () => void = () => {}
      const idle = new Promise<void>(resolve => { resolveIdle = resolve })
      const agent = {
        id: sessionId,
        status: 'idle',
        session,
        followup() {
          queueMicrotask(() => {
            ctx.emit('session/event' as never, session as never, {
              type: 'assistant/message',
              data: { message: { content: [{ type: 'text', text: `answer:${sessionId}` }] } },
            } as never)
            resolveIdle()
          })
        },
        whenIdle: () => idle,
        cancel() { resolveIdle() },
      }
      return { agent: agent as never, dispose: async () => {} }
    },
    list: () => [],
    get: () => undefined,
  })
  await ctx.plugin(DurableWorkflowService, {
    root: mkdtempSync(join(tmpdir(), 'zcd-workflow-run-')),
    maxNodes: 10,
    nodeTimeoutMs: 5_000,
  })
  const service = ctx.get('durableWorkflow') as DurableWorkflowService
  const parent = { session: { id: 'parent', header: { cwd: '/work' } } } as never
  return { ctx, service, parent, created }
}

describe('durable workflow', () => {
  it('runs a script and returns its value', async () => {
    const { ctx, service, parent } = await harness()
    const view = service.start({ script: 'const a = await agent("hi"); return a' }, parent)
    const done = await service.wait(view.id, 5_000)
    expect(done.status).toBe('succeeded')
    expect(done.result).toMatch(/^answer:session-/)
    expect(done.nodeCount).toBe(1)
    await ctx.dispose?.()
  })

  it('replays a completed node on resume instead of calling the model again', async () => {
    const { ctx, service, parent, created } = await harness()
    const view = service.start({ script: 'return await agent("hi")' }, parent)
    await service.wait(view.id, 5_000)
    expect(created).toHaveLength(1)
    service.resume(view.id, parent)
    const done = await service.wait(view.id, 5_000)
    expect(done.status).toBe('succeeded')
    expect(created).toHaveLength(1)
    await ctx.dispose?.()
  })

  it('fails a script with a clear code', async () => {
    const { ctx, service, parent } = await harness()
    const view = service.start({ script: 'throw new Error("boom")' }, parent)
    const done = await service.wait(view.id, 5_000)
    expect(done.status).toBe('failed')
    expect(done.error?.code).toBe('WORKFLOW_FAILED')
    await ctx.dispose?.()
  })
})
