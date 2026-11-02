import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { BrowserService, detectChrome } from '@zcd/browser'
import { DeferredToolsService } from '@zcd/deferred-tools'
import * as toolBrowser from '../src/index.js'

const chrome = detectChrome()

describe.skipIf(chrome === undefined)('browser tools', () => {
  it('opens, snapshots, clicks, types, screenshots, and closes through the tool layer', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(`<!doctype html><title>Tool browser</title>
        <h1>Tool browser</h1>
        <button id="go" onclick="document.getElementById('out').textContent = 'clicked'">Go</button>
        <input id="name" aria-label="Name">
        <div id="out"></div>`)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0

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
    await ctx.plugin(BrowserService, {
      headless: true,
      storageDir: mkdtempSync(join(tmpdir(), 'zcd-tool-browser-')),
    })
    toolBrowser.apply(ctx)

    const exec = { agent: { session: { id: 'tool-session' } } } as never
    const run = async (name: string, args: unknown) => {
      const definition = definitions.get(name)
      if (definition === undefined) throw new Error(`tool ${name} was not registered`)
      return definition.execute(args as never, exec) as Promise<Record<string, unknown>>
    }

    try {
      const opened = await run('browser_open', { url: `http://127.0.0.1:${port}/` })
      expect(opened.title).toBe('Tool browser')

      const snapshot = await run('browser_snapshot', {})
      expect(String(snapshot.text)).toContain('Tool browser')

      await run('browser_click', { selector: '#go' })
      const afterClick = await run('browser_snapshot', {})
      expect(String(afterClick.text)).toContain('clicked')

      await run('browser_type', { selector: '#name', text: 'hello' })
      const afterType = await run('browser_snapshot', {})
      expect(String(afterType.text)).toContain('hello')

      const shot = await run('browser_screenshot', {})
      expect(String(shot.path)).toMatch(/\.png$/)

      expect(await run('browser_close', {})).toEqual({ closed: true })
    } finally {
      await (ctx.get('browser') as BrowserService).shutdown()
      await new Promise<void>(resolve => server.close(() => resolve()))
      await ctx.dispose?.()
    }
  }, 30_000)
})
