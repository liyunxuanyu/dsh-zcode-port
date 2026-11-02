/**
 * `ctx.browser` — one headless Chrome per host, one page per agent session.
 *
 * The service owns the browser process and session isolation. Tools decide
 * what to navigate to; this service only admits absolute HTTP(S) URLs, applies
 * a default timeout, and keeps screenshots out of the model context when they
 * are written to disk. Chrome is located from `ZCD_CHROME_PATH`, the platform's
 * standard install paths, or `Config.executablePath`; no browser binary is
 * downloaded at runtime.
 *
 * @module @zcd/browser
 */

import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { Browser, BrowserContext, Page } from 'playwright-core'

/** Deployment configuration. */
export interface Config {
  /** Run Chrome headless (default true). */
  headless?: boolean
  /** Explicit Chrome/Chromium executable. */
  executablePath?: string
  /** Per-action timeout in milliseconds (default 15000). */
  timeoutMs?: number
  /** Screenshot root; defaults to `$DSH_HOME/storages/zcd-browser`. */
  storageDir?: string
  /** Viewport for new pages. */
  viewport?: { width: number; height: number }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    browser: BrowserService
  }
}

/** One session's isolated context and page. */
interface SessionBrowser {
  context: BrowserContext
  page: Page
}

/**
 * Reject anything that is not an absolute HTTP(S) URL.
 * @param input - candidate URL.
 * @returns normalized URL.
 */
export function assertHttpUrl(input: string): string {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error('browser URL must be absolute, for example https://example.com/')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`browser URL scheme ${url.protocol} is not allowed; use http or https`)
  }
  return url.toString()
}

/**
 * Find a locally installed Chrome/Chromium.
 * @param env - environment for the override.
 * @returns absolute path, or undefined when none is found.
 */
export function detectChrome(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const override = env.ZCD_CHROME_PATH
  if (override !== undefined && override.trim().length > 0 && existsSync(override)) return override
  const candidates = process.platform === 'win32'
    ? [
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      ]
    : process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
          '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        ]
      : [
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
          '/usr/bin/microsoft-edge',
        ]
  return candidates.find(path => existsSync(path))
}

/**
 * Browser service.
 */
export class BrowserService extends Service {
  private readonly config: Required<Pick<Config, 'headless' | 'timeoutMs' | 'storageDir'>> & Config
  private launchPromise?: Promise<Browser>
  private readonly sessions = new Map<string, Promise<SessionBrowser>>()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'browser')
    this.config = {
      ...config,
      headless: config.headless ?? true,
      timeoutMs: config.timeoutMs ?? 15_000,
      storageDir: config.storageDir
        ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'storages', 'zcd-browser'),
    }
  }

  protected [Service.init](): void {
    this.ctx.effect(() => () => { void this.shutdown() }, 'zcd-browser: shutdown')
  }

  /**
   * Get (or create) the page owned by one session.
   * @param sessionId - agent session id.
   * @returns the session page.
   */
  async page(sessionId: string): Promise<Page> {
    const existing = this.sessions.get(sessionId)
    if (existing !== undefined) return (await existing).page
    const created = this.createSession(sessionId)
    this.sessions.set(sessionId, created)
    try {
      return (await created).page
    } catch (error: unknown) {
      this.sessions.delete(sessionId)
      throw error
    }
  }

  /**
   * Close one session's page and context.
   * @param sessionId - agent session id.
   */
  async closeSession(sessionId: string): Promise<void> {
    const existing = this.sessions.get(sessionId)
    if (existing === undefined) return
    this.sessions.delete(sessionId)
    const session = await existing.catch(() => undefined)
    await session?.context.close().catch(() => undefined)
  }

  /**
   * Write a PNG of the session page and return its path.
   * @param sessionId - agent session id.
   * @param options - full-page capture.
   * @returns absolute screenshot path.
   */
  async screenshot(sessionId: string, options: { fullPage?: boolean } = {}): Promise<string> {
    const page = await this.page(sessionId)
    const directory = join(this.config.storageDir, sessionId)
    mkdirSync(directory, { recursive: true })
    const path = join(directory, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`)
    mkdirSync(dirname(path), { recursive: true })
    await page.screenshot({ path, fullPage: options.fullPage ?? false })
    return path
  }

  /** Close the browser and every session. */
  async shutdown(): Promise<void> {
    const sessions = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.allSettled(sessions.map(async session => (await session).context.close()))
    const browser = this.launchPromise
    this.launchPromise = undefined
    if (browser !== undefined) {
      const resolved = await browser.catch(() => undefined)
      await resolved?.close().catch(() => undefined)
    }
  }

  /** Launch Chrome on first use. */
  private async launch(): Promise<Browser> {
    if (this.launchPromise !== undefined) return this.launchPromise
    const executablePath = this.config.executablePath ?? detectChrome()
    if (executablePath === undefined) {
      throw new Error('browser: Chrome/Chromium not found; set ZCD_CHROME_PATH or browser.executablePath')
    }
    const promise = import('playwright-core')
      .then(({ chromium }) => chromium.launch({ headless: this.config.headless, executablePath }))
    this.launchPromise = promise
    try {
      return await promise
    } catch (error: unknown) {
      this.launchPromise = undefined
      throw error
    }
  }

  /** Create an isolated context and page for one session. */
  private async createSession(sessionId: string): Promise<SessionBrowser> {
    const browser = await this.launch()
    const context = await browser.newContext({
      viewport: this.config.viewport ?? { width: 1280, height: 720 },
    })
    const page = await context.newPage()
    page.setDefaultTimeout(this.config.timeoutMs)
    return { context, page }
  }
}

export default BrowserService
