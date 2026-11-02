import { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { DeferredToolsService } from '../src/index.js'

interface Registered {
  definition: ToolDefinition
  when?: (context: { agent: unknown; modelSelection: unknown; signal: AbortSignal }) => boolean | Promise<boolean>
}

const tool = {
  name: 'demo_tool',
  description: 'A deferred demo.',
  parameters: {},
  output: { schema: {}, render: () => [] },
  execute: async () => ({}),
} as unknown as ToolDefinition

/** Build a Cordis context with the two services the seam injects. */
async function harness() {
  const ctx = new Context()
  const registrations: Registered[] = []
  const events: string[] = []

  ctx.provide('tools', {
    register(definition: ToolDefinition, options?: Registered['when'] extends never ? never : { when?: Registered['when'] }) {
      registrations.push({ definition, ...(options?.when === undefined ? {} : { when: options.when }) })
      return () => {}
    },
  })

  ctx.provide('sessionProjections', {
    async register() {
      return { dispose() {} }
    },
    snapshot() {
      return { asOfSeq: 0, values: { zcdDeferredTools: [...events] } }
    },
  })

  await ctx.plugin(DeferredToolsService, {})
  const service = ctx.get('deferredTools') as DeferredToolsService
  const session = {
    id: 'session-1',
    header: { cwd: '/work' },
    append(type: string, data: { name: string }) {
      if (type === 'deferred-tool/loaded') events.push(data.name)
    },
  }
  const agent = { session }
  return { ctx, service, registrations, events, session, agent }
}

describe('deferred admission', () => {
  it('admits a tool only after its session loads it', async () => {
    const { service, registrations, agent } = await harness()
    service.register(tool, { group: 'demo' })
    expect(registrations).toHaveLength(1)

    const when = registrations[0]?.when
    expect(when).toBeDefined()
    const context = {
      agent,
      modelSelection: { provider: 'p', model: 'm' },
      signal: new AbortController().signal,
    }

    expect(await when!(context)).toBe(false)
    expect(service.isPending(agent, 'demo_tool')).toBe(true)

    service.markLoaded(agent.session as never, 'demo_tool', 'demo')

    expect(await when!(context)).toBe(true)
    expect(service.isPending(agent, 'demo_tool')).toBe(false)
    expect(service.entries(agent).find(entry => entry.name === 'demo_tool')?.loaded).toBe(true)
  })

  it('keeps an always-visible tool admitted without a load', async () => {
    const { service, registrations, agent } = await harness()
    service.register(tool, { group: 'demo', alwaysVisible: true })
    const when = registrations[0]?.when
    expect(await when!({
      agent,
      modelSelection: { provider: 'p', model: 'm' },
      signal: new AbortController().signal,
    })).toBe(true)
  })

  it('rejects a duplicate deferred registration', async () => {
    const { service } = await harness()
    service.register(tool, { group: 'demo' })
    expect(() => service.register(tool, { group: 'demo' })).toThrow(/already registered/)
  })
})
