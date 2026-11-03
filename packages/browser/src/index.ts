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
import { BrowserCodeAct, type CodeActInput, type CodeActResult } from './code-act.js'

export type { CodeActBindings, CodeActInput, CodeActResult } from './code-act.js'

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
  /** Wall-clock budget for one `browser_act` call (default 60000). */
  codeActTimeoutMs?: number
  /** Combined result/stdout cap for one `browser_act` call (default 60000 chars). */
  codeActMaxChars?: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    browser: BrowserService
  }
}

/** One session's isolated context and its tabs. */
interface SessionBrowser {
  context: BrowserContext
  pages: Map<string, Page>
  active: string | undefined
  next: number
}

/** Public tab identity. */
export interface TabInfo {
  id: string
  url: string
  title: string
  active: boolean
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
  private readonly codeAct: BrowserCodeAct

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'browser')
    this.config = {
      ...config,
      headless: config.headless ?? true,
      timeoutMs: config.timeoutMs ?? 15_000,
      storageDir: config.storageDir
        ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'storages', 'zcd-browser'),
    }
    this.codeAct = new BrowserCodeAct({
      page: async sessionId => await this.page(sessionId),
      screenshot: async sessionId => await this.screenshot(sessionId),
      listTabs: async sessionId => await this.listTabs(sessionId),
      newTab: async (sessionId, url) => await this.newTab(sessionId, url),
      switchTab: async (sessionId, tabId) => { await this.switchTab(sessionId, tabId) },
      closeTab: async (sessionId, tabId) => { await this.closeTab(sessionId, tabId) },
    }, {
      ...(config.codeActTimeoutMs === undefined ? {} : { timeoutMs: config.codeActTimeoutMs }),
      ...(config.codeActMaxChars === undefined ? {} : { maxOutputChars: config.codeActMaxChars }),
    })
  }

  /**
   * Run one Node-level code-act body against the session browser.
   *
   * This is the v2 entry point: instead of a tool per DOM operation, the model
   * writes one small script that drives the page. The runner owns the sandbox,
   * the output budget, and the per-session globals.
   *
   * @param sessionId - owning agent session.
   * @param input - code body and a short label.
   * @returns captured result, stdout, and timing.
   */
  async act(sessionId: string, input: CodeActInput): Promise<CodeActResult> {
    return await this.codeAct.run(sessionId, input)
  }

  /**
   * Drop the code-act globals of one session (called when the session browser closes).
   * @param sessionId - agent session id.
   */
  resetAct(sessionId: string): void {
    this.codeAct.reset(sessionId)
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
    const session = await this.session(sessionId)
    let page = session.active === undefined ? undefined : session.pages.get(session.active)
    if (page === undefined || page.isClosed()) {
      page = await this.openTab(session)
    }
    return page
  }

  /**
   * Open a new tab and make it active.
   * @param sessionId - agent session id.
   * @param url - optional absolute http(s) URL.
   * @returns the new tab's identity.
   */
  async newTab(sessionId: string, url?: string): Promise<TabInfo> {
    const session = await this.session(sessionId)
    const page = await this.openTab(session)
    if (url !== undefined) await page.goto(assertHttpUrl(url), { waitUntil: 'domcontentloaded' })
    return this.tabInfo(page, session)
  }

  /**
   * List the session's tabs.
   * @param sessionId - agent session id.
   * @returns tabs in creation order.
   */
  async listTabs(sessionId: string): Promise<TabInfo[]> {
    const session = await this.session(sessionId)
    const rows: TabInfo[] = []
    for (const [id, page] of session.pages) {
      if (page.isClosed()) continue
      rows.push(await this.tabInfo(page, session, id))
    }
    return rows
  }

  /**
   * Make one tab active.
   * @param sessionId - agent session id.
   * @param tabId - id from `listTabs`.
   */
  async switchTab(sessionId: string, tabId: string): Promise<void> {
    const session = await this.session(sessionId)
    const page = session.pages.get(tabId)
    if (page === undefined || page.isClosed()) throw new Error(`browser tab ${tabId} does not exist`)
    session.active = tabId
    await page.bringToFront().catch(() => undefined)
  }

  /**
   * Close one tab. Closing the last tab releases the session context.
   * @param sessionId - agent session id.
   * @param tabId - id from `listTabs`.
   */
  async closeTab(sessionId: string, tabId: string): Promise<void> {
    const session = await this.session(sessionId)
    const page = session.pages.get(tabId)
    if (page === undefined) throw new Error(`browser tab ${tabId} does not exist`)
    session.pages.delete(tabId)
    await page.close().catch(() => undefined)
    if (session.active === tabId) session.active = session.pages.keys().next().value
    if (session.pages.size === 0) {
      this.sessions.delete(sessionId)
      await session.context.close().catch(() => undefined)
    }
  }

  /**
   * Close one session's page and context.
   * @param sessionId - agent session id.
   */
  async closeSession(sessionId: string): Promise<void> {
    this.codeAct.reset(sessionId)
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

  /** Get or create the session container. */
  private async session(sessionId: string): Promise<SessionBrowser> {
    const existing = this.sessions.get(sessionId)
    if (existing !== undefined) return existing
    const created = this.createSession(sessionId)
    this.sessions.set(sessionId, created)
    try {
      return await created
    } catch (error: unknown) {
      this.sessions.delete(sessionId)
      throw error
    }
  }

  /** Open a blank tab inside an existing session. */
  private async openTab(session: SessionBrowser): Promise<Page> {
    const page = await session.context.newPage()
    page.setDefaultTimeout(this.config.timeoutMs)
    const id = `tab-${session.next++}`
    session.pages.set(id, page)
    session.active = id
    return page
  }

  /** Read one tab's public identity. */
  private async tabInfo(page: Page, session: SessionBrowser, id?: string): Promise<TabInfo> {
    let tabId = id
    if (tabId === undefined) {
      for (const [candidate, value] of session.pages) if (value === page) tabId = candidate
    }
    return {
      id: tabId ?? 'tab-0',
      url: page.url(),
      title: await page.title().catch(() => ''),
      active: session.active === tabId,
    }
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

  /** Create an isolated context for one session. */
  private async createSession(_sessionId: string): Promise<SessionBrowser> {
    const browser = await this.launch()
    const context = await browser.newContext({
      viewport: this.config.viewport ?? { width: 1280, height: 720 },
    })
    return { context, pages: new Map(), active: undefined, next: 1 }
  }
}

export default BrowserService
