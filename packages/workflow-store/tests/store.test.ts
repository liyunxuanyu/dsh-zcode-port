import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FileWorkflowStore } from '../src/index.js'

function store() {
  return new FileWorkflowStore(mkdtempSync(join(tmpdir(), 'zcd-workflow-')))
}

describe('FileWorkflowStore', () => {
  it('creates, updates, and lists runs', () => {
    const s = store()
    s.createRun({
      id: 'run-1', name: 'demo', status: 'queued', script: 'return 1', scriptHash: 'h',
      args: {}, createdAt: 1, updatedAt: 1, nodeCount: 0,
    })
    s.updateRun('run-1', { status: 'succeeded', result: 1 })
    expect(s.getRun('run-1')?.status).toBe('succeeded')
    expect(s.listRuns()).toHaveLength(1)
    expect(s.readEvents('run-1').map(event => event.type)).toContain('run/created')
  })

  it('persists and reads nodes by id', () => {
    const s = store()
    s.createRun({
      id: 'run-2', name: 'demo', status: 'running', script: 'x', scriptHash: 'h',
      args: {}, createdAt: 1, updatedAt: 1, nodeCount: 0,
    })
    s.putNode({
      runId: 'run-2', nodeId: 'n1', index: 0, prompt: 'p', status: 'succeeded',
      output: 'ok', startedAt: 1, endedAt: 2,
    })
    expect(s.getNode('run-2', 'n1')?.output).toBe('ok')
  })

  it('derives stable node ids from script, ordinal, and prompt', () => {
    const a = FileWorkflowStore.nodeId('hash', 0, 'same')
    const b = FileWorkflowStore.nodeId('hash', 0, 'same')
    const c = FileWorkflowStore.nodeId('hash', 1, 'same')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toHaveLength(20)
  })
})
