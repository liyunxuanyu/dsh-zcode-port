import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.js'

/** Build the gate over a fake session log that can be updated between calls. */
function harness() {
  const ctx = new Context()
  const state: { events: unknown[] } = { events: [] }
  ctx.provide('sessionQuery', {
    async readSession() {
      return { session: { id: 'session-1' }, inheritedEventCount: 0, events: state.events }
    },
  })
  apply(ctx)
  const exec = (name: string, args: unknown = {}) => ({
    name,
    arguments: args,
    agent: { session: { id: 'session-1' } },
  }) as never
  const allow = async () => ({ kind: 'allow' as const })
  return { ctx, state, exec, allow }
}

/** Append one successful skill call to the fake log. */
function loadSkill(state: { events: unknown[] }, name: string) {
  state.events.push(
    { type: 'tool/call', data: { callId: 'call-1', name: 'skill', arguments: JSON.stringify({ name }) } },
    { type: 'tool/result', data: { message: { toolCallId: 'call-1', isError: false } } },
  )
}

describe('skill gate integration', () => {
  it('denies workflow_run before the skill is loaded and allows it afterwards', async () => {
    const { ctx, state, exec, allow } = harness()
    const denied = await ctx.waterfall('tools/pre-execute', exec('workflow_run', { script: 'return 1' }), allow)
    expect(denied).toMatchObject({ kind: 'deny' })
    expect(denied.reason).toMatch(/dynamic-workflows/)

    loadSkill(state, 'dynamic-workflows')
    const allowed = await ctx.waterfall('tools/pre-execute', exec('workflow_run', { script: 'return 1' }), allow)
    expect(allowed).toEqual({ kind: 'allow' })
  })

  it('leaves resume and read-only tools untouched', async () => {
    const { ctx, exec, allow } = harness()
    expect(await ctx.waterfall('tools/pre-execute', exec('workflow_resume', { run_id: 'r' }), allow))
      .toEqual({ kind: 'allow' })
    expect(await ctx.waterfall('tools/pre-execute', exec('read', { path: 'a' }), allow))
      .toEqual({ kind: 'allow' })
  })
})
