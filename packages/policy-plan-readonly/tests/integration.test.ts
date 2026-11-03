import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.js'

/** Build a context whose plan projection reports the given state. */
function harness(active: boolean, options: { enabled?: boolean; settings?: Record<string, unknown> } = {}) {
  const ctx = new Context()
  ctx.provide('sessionProjections', {
    snapshot: () => ({ asOfSeq: 0, values: { plan: { active, pending: false } } }),
  })
  if (options.settings !== undefined) {
    const values: Record<string, unknown> = { ...options.settings }
    ctx.provide('runtimeSettings', {
      get: (key: string) => values[key],
      update: (patch: Record<string, unknown>) => { Object.assign(values, patch); return values },
    })
  }
  apply(ctx, { enabled: options.enabled ?? true })
  const exec = (name: string, args: unknown = {}) => ({
    name,
    arguments: args,
    agent: { session: { id: 'session-1' } },
  }) as never
  const allow = async () => ({ kind: 'allow' as const })
  return { ctx, exec, allow }
}

describe('plan-mode policy integration', () => {
  it('denies a write while the plan is active', async () => {
    const { ctx, exec, allow } = harness(true)
    const decision = await ctx.waterfall('tools/pre-execute', exec('write', { path: 'a.txt' }), allow)
    expect(decision).toMatchObject({ kind: 'deny' })
    expect(decision.reason).toMatch(/Plan mode/)
  })

  it('allows a read and still runs the next decision', async () => {
    const { ctx, exec, allow } = harness(true)
    const decision = await ctx.waterfall('tools/pre-execute', exec('read', { path: 'a.txt' }), allow)
    expect(decision).toEqual({ kind: 'allow' })
  })

  it('classifies bash and lets a read-only command through', async () => {
    const { ctx, exec, allow } = harness(true)
    const denied = await ctx.waterfall('tools/pre-execute', exec('bash', { command: 'rm -rf out' }), allow)
    expect(denied).toMatchObject({ kind: 'deny' })
    const allowed = await ctx.waterfall('tools/pre-execute', exec('bash', { command: 'git status' }), allow)
    expect(allowed).toEqual({ kind: 'allow' })
  })

  it('does nothing when no plan is active', async () => {
    const { ctx, exec, allow } = harness(false)
    const decision = await ctx.waterfall('tools/pre-execute', exec('write', { path: 'a.txt' }), allow)
    expect(decision).toEqual({ kind: 'allow' })
  })

  it('stays inert until the settings page enables it', async () => {
    const off = harness(true, { enabled: false })
    expect(await off.ctx.waterfall('tools/pre-execute', off.exec('write', { path: 'a.txt' }), off.allow))
      .toEqual({ kind: 'allow' })

    const on = harness(true, { enabled: false, settings: { 'policy.planReadonly.enabled': true } })
    expect(await on.ctx.waterfall('tools/pre-execute', on.exec('write', { path: 'a.txt' }), on.allow))
      .toMatchObject({ kind: 'deny' })
  })

  it('lets the setting disable an enabled policy', async () => {
    const { ctx, exec, allow } = harness(true, { enabled: true, settings: { 'policy.planReadonly.enabled': false } })
    const decision = await ctx.waterfall('tools/pre-execute', exec('write', { path: 'a.txt' }), allow)
    expect(decision).toEqual({ kind: 'allow' })
  })

  it('reads the bash classifier switch per call', async () => {
    const { ctx, exec, allow } = harness(true, {
      enabled: true,
      settings: { 'policy.planReadonly.enabled': true, 'policy.planReadonly.classifyBash': false },
    })
    const decision = await ctx.waterfall('tools/pre-execute', exec('bash', { command: 'rm -rf out' }), allow)
    expect(decision).toEqual({ kind: 'allow' })
  })
})
