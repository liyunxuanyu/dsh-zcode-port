import { mkdtempSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { BrowserService, assertHttpUrl, detectChrome } from '../src/index.js'

describe('assertHttpUrl', () => {
  it('accepts http and https and normalizes them', () => {
    expect(assertHttpUrl('https://example.com')).toBe('https://example.com/')
    expect(assertHttpUrl('http://127.0.0.1:8080/path')).toBe('http://127.0.0.1:8080/path')
  })

  it('rejects local files, data URLs, and relative input', () => {
    expect(() => assertHttpUrl('file:///etc/passwd')).toThrow(/not allowed/)
    expect(() => assertHttpUrl('data:text/html,hi')).toThrow(/not allowed/)
    expect(() => assertHttpUrl('/relative')).toThrow(/absolute/)
  })
})

const chrome = detectChrome()

describe.skipIf(chrome === undefined)('BrowserService', () => {
  it('navigates, reads, interacts, and screenshots in an isolated page', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(`<!doctype html><title>ZCD browser</title>
        <h1>ZCD browser</h1>
        <button id="go" onclick="document.getElementById('out').textContent = 'clicked'">Go</button>
        <input id="name" aria-label="Name">
        <div id="out"></div>`)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0

    const ctx = new Context()
    await ctx.plugin(BrowserService, {
      headless: true,
      storageDir: mkdtempSync(join(tmpdir(), 'zcd-browser-')),
    })
    const browser = ctx.get('browser') as BrowserService
    try {
      const page = await browser.page('test-session')
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' })
      expect(await page.title()).toBe('ZCD browser')
      const snapshot = await page.locator('body').ariaSnapshot()
      expect(snapshot).toContain('ZCD browser')

      await page.locator('#go').click()
      expect(await page.locator('#out').textContent()).toBe('clicked')
      await page.locator('#name').fill('hello')
      expect(await page.locator('#name').inputValue()).toBe('hello')

      const path = await browser.screenshot('test-session')
      expect(statSync(path).size).toBeGreaterThan(100)
    } finally {
      await browser.shutdown()
      await new Promise<void>(resolve => server.close(() => resolve()))
      await ctx.dispose?.()
    }
  }, 30_000)
})
