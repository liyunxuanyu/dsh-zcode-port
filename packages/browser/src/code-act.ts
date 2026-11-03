/**
 * Node-level code-act runner for the session browser.
 *
 * One `browser_act` call runs a plain-JavaScript body in a fresh `node:vm`
 * context that has **no** `require`, `process`, `fs`, or network primitives:
 * the only capabilities are the bindings documented in {@link CodeActBindings}.
 * That makes the tool a single entry point for multi-step browser work without
 * handing the model a general Node execution surface.
 *
 * Each body runs inside its own async function, so `var`/`let`/`const` are
 * call-scoped and disappear when the call returns. Two things do persist per
 * session: the injected `state` object and anything assigned to `globalThis`
 * (`globalThis.total = 1` in one call is readable in the next).
 *
 * @module @zcd/browser/code-act
 */

import vm from 'node:vm'
import * as acorn from 'acorn'

/** Everything a script may touch. */
export interface CodeActBindings {
  /** Navigate the active page; resolves to `{ url, title }`. */
  goto: (url: string) => Promise<{ url: string; title: string }>
  /** Accessibility tree of the active page as text. */
  snapshot: () => Promise<string>
  /** Click one selector that resolves to exactly one element. */
  click: (selector: string) => Promise<void>
  /** Fill one input and optionally press Enter. */
  type: (selector: string, text: string, options?: { submit?: boolean }) => Promise<void>
  /** Evaluate JavaScript in the page and return its JSON-safe value. */
  evaluate: <T = unknown>(code: string) => Promise<T>
  /** Save a PNG and return its absolute path. */
  screenshot: (options?: { fullPage?: boolean }) => Promise<string>
  /** List tabs as `{ id, url, title, active }`. */
  tabs: () => Promise<readonly { id: string; url: string; title: string; active: boolean }[]>
  /** Open a tab, optionally at an http(s) URL. */
  newTab: (url?: string) => Promise<{ id: string; url: string; title: string }>
  /** Make a tab active. */
  switchTab: (tabId: string) => Promise<void>
  /** Close a tab. */
  closeTab: (tabId: string) => Promise<void>
  /** Wait for a selector to appear. */
  waitFor: (selector: string, options?: { timeoutMs?: number }) => Promise<void>
  /** Append to the tool's output stream. */
  write: (value: unknown) => void
  /** Scratch space that survives across calls in one session. */
  state: Record<string, unknown>
}

/** One call's input. */
export interface CodeActInput {
  /** JavaScript body; top-level `await` is allowed. */
  code: string
  /** Short user-visible label for the step. */
  title: string
}

/** One call's result. */
export interface CodeActResult {
  /** Serialized last expression, or the collected `write()` output. */
  result: string
  /** Buffered `console.*` lines. */
  stdout: string
  durationMs: number
  /** Whether `result` or `stdout` was cut to stay inside the byte budget. */
  truncated: boolean
}

/** Dependencies the runner needs from the browser service. */
export interface CodeActHost {
  /** Resolve the active page of one session. */
  page: (sessionId: string) => Promise<unknown>
  /** Save a screenshot for one session. */
  screenshot: (sessionId: string) => Promise<string>
  /** List tabs of one session. */
  listTabs: (sessionId: string) => Promise<readonly { id: string; url: string; title: string; active: boolean }[]>
  /** Open a tab. */
  newTab: (sessionId: string, url?: string) => Promise<{ id: string; url: string; title: string }>
  /** Activate a tab. */
  switchTab: (sessionId: string, tabId: string) => Promise<void>
  /** Close a tab. */
  closeTab: (sessionId: string, tabId: string) => Promise<void>
}

/** Deployment options. */
export interface CodeActOptions {
  /** Wall-clock budget for one call (default 60s). */
  timeoutMs?: number
  /** Cap for `result` and `stdout` together (default 60k chars). */
  maxOutputChars?: number
}


/** Options for {@link compileBody}. */
export interface CompileOptions {
  /** Treat the final statement as the result (REPL semantics). */
  repl?: boolean
}

/**
 * Compile a script body.
 *
 * With `repl` (the default) the body behaves like a REPL entry: when nothing
 * was written and the last *statement* is an expression, it is returned, so
 * `await goto(url); await snapshot()` yields the snapshot and `1 + 1` yields 2.
 * A body that already `return`s, or that `write()`s, is used verbatim.
 *
 * The transformation is done by locating the final statement in the plain
 * (non-REPL) compilation, which is why a syntactically invalid body fails here
 * with a parse error instead of a confusing wrapped one.
 *
 * @param code - user-supplied body.
 * @param options - REPL vs verbatim.
 * @returns a compiled script.
 * @throws when the body does not parse.
 */
export function compileBody(code: string, options: CompileOptions = {}): vm.Script {
  const repl = options.repl ?? true
  const make = (source: string): vm.Script => new vm.Script(`(async () => {\n${source}\n})()`, { filename: 'browser_act.js' })

  let base: vm.Script
  try {
    base = make(code)
  } catch (error: unknown) {
    throw new Error(`browser_act could not parse the code: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!repl || /\breturn\b/.test(code)) return base

  // Re-parse with the same wrapper so any trailing `;`/comment stays valid,
  // then move the last statement into a `return (...)`.
  const wrapped = `(async () => {\n${code}\n//#zcd-end\n})()`
  let program: acorn.Program
  try {
    program = acorn.parse(wrapped, { ecmaVersion: 'latest', allowAwaitOutsideFunction: true, sourceType: 'script' })
  } catch {
    return base
  }
  const fn = program.body[0]
  if (fn?.type !== 'ExpressionStatement' || fn.expression.type !== 'CallExpression') return base
  const arrow = fn.expression.callee
  if (arrow.type !== 'ArrowFunctionExpression') return base
  const statements = arrow.body.type === 'BlockStatement' ? arrow.body.body : []
  const last = statements[statements.length - 1]
  if (last === undefined || last.type !== 'ExpressionStatement') return base

  const prefix = '(async () => {\n'.length
  const start = last.start - prefix
  const end = last.end - prefix
  const head = code.slice(0, start)
  const tail = code.slice(start, end).replace(/;\s*$/, '')
  try {
    return make(`${head}return (\n${tail}\n)`)
  } catch {
    return base
  }
}

/** Marker so the vm timeout error is distinguishable from a script throw. */
const SYNC_TIMEOUT_MESSAGE = 'browser_act exceeded its synchronous time budget'

/** Minimal page shape the runner relies on. */
interface PageLike {
  goto: (url: string, options?: { waitUntil?: string }) => Promise<unknown>
  locator: (selector: string) => {
    ariaSnapshot: () => Promise<string>
    click: () => Promise<void>
    fill: (text: string) => Promise<void>
    press: (key: string) => Promise<void>
    waitFor: (options?: { timeout?: number }) => Promise<void>
  }
  evaluate: <T>(code: string) => Promise<T>
  url: () => string
  title: () => Promise<string>
}

/** Serialize one script value into text without throwing on cycles. */
function serialize(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * Execute `browser_act` bodies.
 */
export class BrowserCodeAct {
  private readonly contexts = new Map<string, vm.Context>()
  private readonly timeoutMs: number
  private readonly maxOutputChars: number

  constructor(private readonly host: CodeActHost, options: CodeActOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 60_000
    this.maxOutputChars = options.maxOutputChars ?? 60_000
  }

  /** Drop one session's persistent globals and scratch space. */
  reset(sessionId: string): void {
    this.contexts.delete(sessionId)
    this.stateObjects.delete(sessionId)
  }

  /** Build the binding object for one session. */
  private bindings(sessionId: string, sink: { written: string[]; logs: string[] }): CodeActBindings {
    const host = this.host
    const page = async (): Promise<PageLike> => await host.page(sessionId) as PageLike
    return {
      async goto(url) {
        const target = await page()
        await target.goto(url, { waitUntil: 'domcontentloaded' })
        return { url: target.url(), title: await target.title().catch(() => '') }
      },
      async snapshot() {
        return await (await page()).locator('body').ariaSnapshot().catch(() => '')
      },
      async click(selector) {
        await (await page()).locator(selector).click()
      },
      async type(selector, text, options) {
        const input = (await page()).locator(selector)
        await input.fill(text)
        if (options?.submit === true) await input.press('Enter')
      },
      async evaluate<T>(code: string) {
        return await (await page()).evaluate<T>(code)
      },
      async screenshot(options) {
        void options
        return await host.screenshot(sessionId)
      },
      async tabs() {
        return await host.listTabs(sessionId)
      },
      async newTab(url) {
        return await host.newTab(sessionId, url)
      },
      async switchTab(tabId) {
        await host.switchTab(sessionId, tabId)
      },
      async closeTab(tabId) {
        await host.closeTab(sessionId, tabId)
      },
      async waitFor(selector, options) {
        await (await page()).locator(selector).waitFor({ ...(options?.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }) })
      },
      write(value) {
        sink.written.push(typeof value === 'string' ? value : serialize(value))
      },
      state: this.stateFor(sessionId),
    }
  }

  /** Get or create the per-session scratch object inside its context. */
  private stateFor(sessionId: string): Record<string, unknown> {
    const existing = this.stateObjects.get(sessionId)
    if (existing !== undefined) return existing
    const created: Record<string, unknown> = {}
    this.stateObjects.set(sessionId, created)
    return created
  }

  private readonly stateObjects = new Map<string, Record<string, unknown>>()

  /**
   * Run one script body.
   * @param sessionId - owning agent session.
   * @param input - code and label.
   * @returns captured output and timing.
   */
  async run(sessionId: string, input: CodeActInput): Promise<CodeActResult> {
    const code = input.code.trim()
    if (code.length === 0) throw new Error('browser_act code must not be empty')
    const started = Date.now()
    const written: string[] = []
    const logs: string[] = []
    const bindings = this.bindings(sessionId, { written, logs })

    // `console` is a per-call shim so output order is deterministic; the rest
    // of the context (and therefore `var` globals) persists per session.
    const sandbox: Record<string, unknown> = {
      ...bindings,
      console: {
        log: (...args: unknown[]) => { logs.push(args.map(serialize).join(' ')) },
        info: (...args: unknown[]) => { logs.push(args.map(serialize).join(' ')) },
        warn: (...args: unknown[]) => { logs.push(`warn: ${args.map(serialize).join(' ')}`) },
        error: (...args: unknown[]) => { logs.push(`error: ${args.map(serialize).join(' ')}`) },
      },
      JSON,
      Math,
      Date,
      URL,
      Promise,
      setTimeout: undefined,
      setInterval: undefined,
      fetch: undefined,
      require: undefined,
      process: undefined,
    }

    let context = this.contexts.get(sessionId)
    if (context === undefined) {
      context = vm.createContext(sandbox, { name: `zcd-browser-act-${sessionId}` })
      this.contexts.set(sessionId, context)
    } else {
      // Refresh the call-scoped helpers while leaving user globals intact.
      Object.assign(context, sandbox)
    }

    const script = compileBody(code, { repl: true })

    let value: unknown
    try {
      const pending = script.runInContext(context, { timeout: 5_000 }) as Promise<unknown>
      const budget = new Promise<never>((_resolve, reject) => {
        const timer = setTimeout(() => { reject(new Error(`browser_act exceeded ${this.timeoutMs}ms`)) }, this.timeoutMs)
        timer.unref?.()
      })
      value = await Promise.race([pending, budget])
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('Script execution timed out')) throw new Error(SYNC_TIMEOUT_MESSAGE)
      throw error instanceof Error ? error : new Error(message)
    }

    const resultText = value === undefined ? written.join('\n') : serialize(value)
    const stdout = logs.join('\n')
    const cap = this.maxOutputChars
    let result = resultText
    let truncated = false
    let out = stdout
    if (result.length > cap) {
      result = result.slice(0, cap)
      truncated = true
    }
    const remaining = cap - result.length
    if (out.length > remaining) {
      out = out.slice(0, Math.max(0, remaining))
      truncated = true
    }
    return { result, stdout: out, durationMs: Date.now() - started, truncated }
  }
}
