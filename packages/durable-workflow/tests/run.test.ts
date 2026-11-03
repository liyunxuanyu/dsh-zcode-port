import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { DurableWorkflowService } from '../src/index.js'

/** Build a context whose child agent emits one assistant message and goes idle. */
async function harness(options: { failTimes?: number } = {}) {
  const ctx = new Context()
  const created: string[] = []
  let parentAgent: unknown
  let remainingFailures = options.failTimes ?? 0
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'test', model: 'fake-model' }),
  })
  ctx.provide('agents', {
    async create({ sessionId }: { sessionId: string }) {
      created.push(sessionId)
      const session = {
        id: sessionId,
        header: { cwd: '/work', origin: 'subagent' as const },
      }
      let resolveIdle: () => void = () => {}
      let rejectIdle: (error: Error) => void = () => {}
      const idle = new Promise<void>((resolve, reject) => { resolveIdle = resolve; rejectIdle = reject })
      const agent = {
        id: sessionId,
        status: 'idle',
        session,
        followup() {
          queueMicrotask(() => {
            if (remainingFailures > 0) {
              remainingFailures -= 1
              rejectIdle(new Error('model exploded'))
              return
            }
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
    get: () => parentAgent,
  })
  await ctx.plugin(DurableWorkflowService, {
    root: mkdtempSync(join(tmpdir(), 'zcd-workflow-run-')),
    maxNodes: 10,
    nodeTimeoutMs: 5_000,
  })
  const service = ctx.get('durableWorkflow') as DurableWorkflowService
  const injected: string[] = []
  const parent = {
    session: { id: 'parent', header: { cwd: '/work' } },
    inject(message: { content: Array<{ type: string; text?: string }> }) {
      injected.push(message.content.map(block => block.text ?? '').join(''))
    },
  } as never
  parentAgent = parent
  return { ctx, service, parent, created, injected }
}

describe('durable workflow', () => {
  it('runs a script and returns its value', async () => {
    const { ctx, service, parent, injected } = await harness()
    const view = service.start({ script: 'const a = await agent("hi"); return a' }, parent)
    const done = await service.wait(view.id, 5_000)
    expect(done.status).toBe('succeeded')
    expect(done.result).toMatch(/^answer:session-/)
    expect(done.nodeCount).toBe(1)
    expect(injected.some(text => text.includes('is succeeded'))).toBe(true)
    const types = service.events(view.id).map(event => event.type)
    expect(types).toContain('run/created')
    expect(types).toContain('node/started')
    expect(types).toContain('node/finished')
    expect(types).toContain('run/finished')
    await ctx.dispose?.()
  })

  it('resumes a settled run from its recorded parent session', async () => {
    const { ctx, service, parent, created } = await harness()
    const view = service.start({ script: 'return await agent("hi")' }, parent)
    await service.wait(view.id, 5_000)
    expect(created).toHaveLength(1)

    service.resumeFromStore(view.id)
    const done = await service.wait(view.id, 5_000)
    expect(done.status).toBe('succeeded')
    expect(done.nodeCount).toBe(1)
    expect(created).toHaveLength(1)
    await ctx.dispose?.()
  })

  it('amends a settled run from its recorded parent session', async () => {
    const { ctx, service, parent, created } = await harness()
    const view = service.start({ script: 'return await agent("hi")' }, parent)
    await service.wait(view.id, 5_000)

    const renamed = service.amendFromStore(view.id, { name: 'renamed from panel' })
    expect(renamed.id).toBe(view.id)
    expect(renamed.name).toBe('renamed from panel')

    const successor = service.amendFromStore(view.id, { script: 'return await agent("again")' })
    expect(successor.id).not.toBe(view.id)
    const done = await service.wait(successor.id, 5_000)
    expect(done.status).toBe('succeeded')
    expect(created).toHaveLength(2)
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

  it('runs parallel branches with stable keys and replays them all', async () => {
    const { ctx, service, parent, created } = await harness()
    const view = service.start({
      script: 'const out = await parallel(["a","b"], async (item, i) => await agent("do " + item, { key: "p" + i })); return out',
    }, parent)
    const done = await service.wait(view.id, 5_000)
    expect(done.status).toBe('succeeded')
    expect(Array.isArray(done.result)).toBe(true)
    expect(done.nodeCount).toBe(2)
    expect(created).toHaveLength(2)
    service.resume(view.id, parent)
    await service.wait(view.id, 5_000)
    expect(created).toHaveLength(2)
    await ctx.dispose?.()
  })

  it('pauses at a hole and continues after an answer', async () => {
    const { ctx, service, parent, injected } = await harness()
    const view = service.start({ script: 'const code = await hole("need code"); return code' }, parent)
    const paused = await service.wait(view.id, 5_000)
    expect(paused.status).toBe('waiting-hole')
    expect(injected.some(text => text.includes('Hole'))).toBe(true)
    expect(paused.holes?.[0]?.prompt).toBe('need code')
    const holeId = paused.holes?.[0]?.id
    expect(holeId).toBeDefined()
    service.answerHole(view.id, holeId!, 'return 42', parent)
    const done = await service.wait(view.id, 5_000)
    expect(done.status).toBe('succeeded')
    expect(done.result).toBe('return 42')
    await ctx.dispose?.()
  })

  it('amends a script into a successor run and stops the old one', async () => {
    const { ctx, service, parent } = await harness()
    const first = service.start({ script: 'return 1' }, parent)
    await service.wait(first.id, 5_000)
    const second = service.amend(first.id, { script: 'return 2' }, parent)
    expect(second.id).not.toBe(first.id)
    const done = await service.wait(second.id, 5_000)
    expect(done.status).toBe('succeeded')
    expect(done.result).toBe(2)
    expect(service.get(first.id).status).toBe('succeeded')
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

  it('records the routed model and per-node duration', async () => {
    const { ctx, service, parent } = await harness()
    const view = service.start({ script: 'return await agent("hi")' }, parent)
    const done = await service.wait(view.id, 5_000)
    expect(done.status).toBe('succeeded')
    expect(done.durationMs).toBeGreaterThanOrEqual(0)

    const node = service.nodes(view.id)[0]
    expect(node?.model).toBe('test/fake-model')
    expect(node?.endedAt).toBeGreaterThanOrEqual(node?.startedAt ?? 0)

    const finished = service.events(view.id).find(event => event.type === 'node/finished')
    expect((finished?.data as { durationMs?: number }).durationMs).toBeGreaterThanOrEqual(0)
    expect((finished?.data as { model?: string }).model).toBe('test/fake-model')
    await ctx.dispose?.()
  })

  it('drops a failed node so the next resume runs it again', async () => {
    const { ctx, service, parent, created } = await harness({ failTimes: 1 })
    const view = service.start({ script: 'return await agent("hi")' }, parent)
    const failed = await service.wait(view.id, 5_000)
    expect(failed.status).toBe('failed')

    const node = service.nodes(view.id)[0]
    expect(node?.status).toBe('failed')
    expect(node?.model).toBe('test/fake-model')

    const retried = service.retryNode(view.id, node!.nodeId)
    expect(retried.dropped).toBe(true)
    expect(retried.view.nodeCount).toBe(0)
    expect(service.nodes(view.id)).toHaveLength(0)
    expect(service.events(view.id).map(event => event.type)).toContain('node/dropped')

    service.resume(view.id, parent)
    const done = await service.wait(view.id, 5_000)
    expect(done.status).toBe('succeeded')
    expect(done.nodeCount).toBe(1)
    expect(created).toHaveLength(2)
    expect(service.nodes(view.id)[0]?.status).toBe('succeeded')
    await ctx.dispose?.()
  })

  it('refuses to retry a node while the run is still executing', async () => {
    const { ctx, service, parent } = await harness()
    const view = service.start({ script: 'return await agent("hi")' }, parent)
    expect(() => service.retryNode(view.id, 'anything')).toThrow(/running/)
    await service.wait(view.id, 5_000)
    expect(service.retryNode(view.id, 'missing').dropped).toBe(false)
    await ctx.dispose?.()
  })
})
