import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { DeferredToolsService } from '@zcd/deferred-tools'
import { apply } from '../src/index.js'

/** Build the deferred-tool harness and register visualize under a temp root. */
async function harness(maxBytes?: number) {
  const ctx = new Context()
  const definitions = new Map<string, ToolDefinition>()
  ctx.provide('tools', {
    register(definition: ToolDefinition) {
      definitions.set(definition.name, definition)
      return () => {}
    },
  })
  ctx.provide('sessionProjections', {
    register: async () => ({ dispose() {} }),
    snapshot: () => ({ asOfSeq: 0, values: { zcdDeferredTools: [] } }),
  })
  await ctx.plugin(DeferredToolsService, {})
  const root = mkdtempSync(join(tmpdir(), 'zcd-visualize-'))
  apply(ctx, { root, ...(maxBytes === undefined ? {} : { maxBytes }) })
  const exec = { agent: { session: { id: 'session/with space' } } } as never
  return { ctx, definitions, root, exec }
}

describe('visualize', () => {
  it('writes a complete page and returns a sandbox URL', async () => {
    const { ctx, definitions, root, exec } = await harness()
    const definition = definitions.get('visualize')
    if (definition === undefined) throw new Error('visualize was not registered')
    const result = await definition.execute({
      html: '<!doctype html><h1>Hello</h1>',
      title: 'Hello',
      mode: 'inline',
      height: 320,
    } as never, exec) as { artifactId: string; url: string; height: number }
    expect(result.url).toBe(`/zcd/genui/session_with_space/${result.artifactId}`)
    expect(result.height).toBe(320)
    const path = join(root, 'session_with_space', `${result.artifactId}.html`)
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, 'utf8')).toContain('<h1>Hello</h1>')
    await ctx.dispose?.()
  })

  it('rejects an oversized page and clamps height', async () => {
    const { ctx, definitions, exec } = await harness(16)
    const definition = definitions.get('visualize')
    if (definition === undefined) throw new Error('visualize was not registered')
    await expect(definition.execute({ html: 'x'.repeat(32), title: 'big' } as never, exec))
      .rejects.toThrow(/exceeds 16 bytes/)
    const result = await definition.execute({ html: '<p>ok</p>', title: 'small', height: 99999 } as never, exec) as { height: number }
    expect(result.height).toBe(10_000)
    await ctx.dispose?.()
  })
})
