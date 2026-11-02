import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as toolSearch from '@zcd/tool-search'
import * as toolWorkflow from '../src/index.js'

/** Capture the visible and deferred definitions both plugins register. */
function harness() {
  const ctx = new Context()
  const visible: unknown[] = []
  const deferred: unknown[] = []
  ctx.provide('tools', {
    register(definition: unknown) {
      visible.push(definition)
      return () => {}
    },
  })
  ctx.provide('deferredTools', {
    register(definition: unknown) {
      deferred.push(definition)
      return () => {}
    },
  })
  ctx.provide('durableWorkflow', {})
  toolSearch.apply(ctx, { deferred: [], maxResults: 8 })
  toolWorkflow.apply(ctx)
  return { ctx, visible, deferred }
}

describe('visible tool schema budget', () => {
  it('keeps the always-visible ZCD declarations under 8k tokens', () => {
    const { ctx, visible, deferred } = harness()
    const chars = visible.reduce((sum, definition) => {
      const value = definition as {
        name: string
        description: string
        parameters: unknown
        output: { schema: unknown }
      }
      return sum + JSON.stringify({
        name: value.name,
        description: value.description,
        parameters: value.parameters,
        output: value.output.schema,
      }).length
    }, 0)
    // A conservative chars-per-token estimate for English tool declarations.
    const estimatedTokens = Math.ceil(chars / 4)
    expect(visible.map(definition => (definition as { name: string }).name).sort())
      .toEqual(['tool_search', 'workflow_run'])
    expect(deferred.length).toBeGreaterThanOrEqual(6)
    expect(estimatedTokens).toBeLessThan(8_000)
    ctx.dispose?.()
  })
})
