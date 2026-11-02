import { describe, expect, it } from 'vitest'
import { hasLoadedSkill, isGatedCall } from '../src/index.js'

/** Build the minimal event shapes the gate reads. */
function call(callId: string, name: string, args: unknown) {
  return { type: 'tool/call', data: { callId, name, arguments: JSON.stringify(args) } } as never
}
function result(callId: string, isError = false) {
  return { type: 'tool/result', data: { message: { toolCallId: callId, isError } } } as never
}
const compaction = { type: 'compaction/end', data: {} } as never

describe('hasLoadedSkill', () => {
  it('requires a completed non-error skill call', () => {
    expect(hasLoadedSkill([call('a', 'skill', { name: 'dynamic-workflows' })], 'dynamic-workflows')).toBe(false)
    expect(hasLoadedSkill([
      call('a', 'skill', { name: 'dynamic-workflows' }),
      result('a'),
    ], 'dynamic-workflows')).toBe(true)
    expect(hasLoadedSkill([
      call('a', 'skill', { name: 'dynamic-workflows' }),
      result('a', true),
    ], 'dynamic-workflows')).toBe(false)
  })

  it('ignores other tools and other skills', () => {
    expect(hasLoadedSkill([
      call('a', 'read', { path: 'SKILL.md' }),
      result('a'),
      call('b', 'skill', { name: 'office' }),
      result('b'),
    ], 'dynamic-workflows')).toBe(false)
  })

  it('closes again after compaction', () => {
    const events = [
      call('a', 'skill', { name: 'dynamic-workflows' }),
      result('a'),
      compaction,
    ]
    expect(hasLoadedSkill(events, 'dynamic-workflows')).toBe(false)
    expect(hasLoadedSkill([...events,
      call('b', 'skill', { name: 'dynamic-workflows' }),
      result('b'),
    ], 'dynamic-workflows')).toBe(true)
  })
})

describe('isGatedCall', () => {
  it('gates workflow_run and script-changing amend only', () => {
    const gated = new Set(['workflow_run', 'workflow_amend'])
    expect(isGatedCall('workflow_run', {}, gated)).toBe(true)
    expect(isGatedCall('workflow_amend', { script: 'return 1' }, gated)).toBe(true)
    expect(isGatedCall('workflow_amend', { name: 'renamed' }, gated)).toBe(false)
    expect(isGatedCall('workflow_resume', {}, gated)).toBe(false)
    expect(isGatedCall('read', {}, gated)).toBe(false)
  })
})
