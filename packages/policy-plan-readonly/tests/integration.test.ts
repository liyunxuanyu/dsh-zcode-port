import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.js'

/** Build a context whose plan projection reports the given state. */
function harness(active: boolean) {
  const ctx = new Context()
  ctx.provide('sessionProjections', {
    snapshot: () => ({ asOfSeq: 0, values: { plan: { active, pending: false } } }),
  })
  apply(ctx)
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
})
