import { describe, expect, it } from 'vitest'
import { decidePlanMode } from '../src/index.js'

const denied = new Set(['write', 'edit'])

describe('decidePlanMode', () => {
  it('allows everything outside plan mode', () => {
    expect(decidePlanMode({ active: false, toolName: 'write', denied, classifyBash: true })).toBeUndefined()
  })

  it('denies mutating tools while planning', () => {
    expect(decidePlanMode({ active: true, toolName: 'write', denied, classifyBash: true })?.kind).toBe('deny')
    expect(decidePlanMode({ active: true, toolName: 'edit', denied, classifyBash: true })?.kind).toBe('deny')
  })

  it('keeps read-only tools available', () => {
    expect(decidePlanMode({ active: true, toolName: 'read', denied, classifyBash: true })).toBeUndefined()
  })

  it('classifies bash while planning', () => {
    expect(decidePlanMode({
      active: true, toolName: 'bash', command: 'git status', denied, classifyBash: true,
    })).toBeUndefined()
    expect(decidePlanMode({
      active: true, toolName: 'bash', command: 'rm -rf build', denied, classifyBash: true,
    })?.kind).toBe('deny')
    expect(decidePlanMode({
      active: true, toolName: 'bash', denied, classifyBash: true,
    })?.kind).toBe('deny')
  })
})
