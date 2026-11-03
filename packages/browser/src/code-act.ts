/**
 * Node-level code-act runner for the session browser.
 *
 * One `browser_act` call runs a plain-JavaScript body in a per-session
 * `node:vm` context. The context is created from a null-prototype sandbox with
 * string code generation disabled; the functions the script can reach are
 * created **inside** that context and marshal arguments/results through JSON.
 * Host functions and host promises never become visible to the script, so
 * `constructor` chains cannot reach the host realm (`process`, `require`, `fs`,
 * network).
 *
 * This is defence in depth, not a formal security boundary: `node:vm` is not a
 * hardened sandbox. `browser_act` is still a privileged, model-authored
 * execution surface; deployments that enable it should treat it like shell
 * access.
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

/**
 * Bootstrap evaluated **inside** the vm context.
 *
 * It receives one host bridge and creates the only functions the script can
 * call. Each wrapper returns a context-realm Promise and JSON-decodes results,
 * so neither a host function nor a host promise is ever visible to the script.
 */
const BOOTSTRAP = `(bridge) => {
  const call = (name) => (...args) => new Promise((resolve, reject) => {
    let payload
    try {
      payload = JSON.stringify(args)
    } catch (error) {
      reject(String(error))
      return
    }
    bridge(name, payload).then(
      (text) => {
        try {
          resolve(text === null ? undefined : JSON.parse(text))
        } catch (error) {
          reject(String(error))
        }
      },
      (error) => reject(String(error && error.message ? error.message : error)),
    )
  })
  const emit = (name, value) => {
    try {
      bridge(name, JSON.stringify([value]))
    } catch (error) {
      // Output is best-effort; a bridge failure must not change control flow.
    }
  }
  globalThis.goto = call('goto')
  globalThis.snapshot = call('snapshot')
  globalThis.click = call('click')
  globalThis.type = call('type')
  globalThis.evaluate = call('evaluate')
  globalThis.screenshot = call('screenshot')
  globalThis.tabs = call('tabs')
  globalThis.newTab = call('newTab')
  globalThis.switchTab = call('switchTab')
  globalThis.closeTab = call('closeTab')
  globalThis.waitFor = call('waitFor')
  globalThis.write = (value) => emit('write', value)
  globalThis.console = {
    log: (...args) => emit('log', args),
    info: (...args) => emit('log', args),
    warn: (...args) => emit('warn', args),
    error: (...args) => emit('error', args),
  }
  globalThis.state = {}
}`

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

/** Per-call output sink, read by the session bridge. */
interface Sink {
  written: string[]
  logs: string[]
}

/** One session's persistent context and its output sink. */
interface ActSession {
  context: vm.Context
  sink: Sink
}

/**
 * Execute `browser_act` bodies.
 */
export class BrowserCodeAct {
  private readonly sessions = new Map<string, ActSession>()
  private readonly timeoutMs: number
  private readonly maxOutputChars: number

  constructor(private readonly host: CodeActHost, options: CodeActOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 60_000
    this.maxOutputChars = options.maxOutputChars ?? 60_000
  }

  /** Drop one session's persistent globals and scratch space. */
  reset(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  /**
   * Build the host bridge for one session. It crosses the boundary only as
   * JSON text; the returned function has no prototype and is reachable solely
   * from the bootstrap closure.
   */
  private bridge(sessionId: string, sink: () => Sink | undefined): (name: string, payload: string) => Promise<string | null> {
    const host = this.host
    const dispatch = async (name: string, args: unknown[]): Promise<unknown> => {
      const page = async (): Promise<PageLike> => await host.page(sessionId) as PageLike
      switch (name) {
        case 'goto': {
          const target = await page()
          await target.goto(String(args[0]), { waitUntil: 'domcontentloaded' })
          return { url: target.url(), title: await target.title().catch(() => '') }
        }
        case 'snapshot':
          return await (await page()).locator('body').ariaSnapshot().catch(() => '')
        case 'click':
          await (await page()).locator(String(args[0])).click()
          return null
        case 'type': {
          const input = (await page()).locator(String(args[0]))
          await input.fill(String(args[1]))
          const options = args[2] as { submit?: boolean } | undefined
          if (options?.submit === true) await input.press('Enter')
          return null
        }
        case 'evaluate':
          return await (await page()).evaluate(String(args[0]))
        case 'screenshot':
          await host.screenshot(sessionId)
          return null
        case 'tabs':
          return await host.listTabs(sessionId)
        case 'newTab':
          return await host.newTab(sessionId, args[0] === undefined ? undefined : String(args[0]))
        case 'switchTab':
          await host.switchTab(sessionId, String(args[0]))
          return null
        case 'closeTab':
          await host.closeTab(sessionId, String(args[0]))
          return null
        case 'waitFor': {
          const options = args[1] as { timeoutMs?: number } | undefined
          await (await page()).locator(String(args[0])).waitFor({
            ...(options?.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
          })
          return null
        }
        default:
          throw new Error(`unknown browser_act binding: ${name}`)
      }
    }

    const bridge = async (name: string, payload: string): Promise<string | null> => {
      if (name === 'log' || name === 'warn' || name === 'error') {
        const [values] = JSON.parse(payload) as [unknown[]]
        const text = Array.isArray(values) ? values.map(serialize).join(' ') : serialize(values)
        sink()?.logs.push(name === 'log' ? text : `${name}: ${text}`)
        return null
      }
      if (name === 'write') {
        const [value] = JSON.parse(payload) as [unknown]
        sink()?.written.push(serialize(value))
        return null
      }
      const args = JSON.parse(payload) as unknown[]
      const value = await dispatch(name, args)
      return value === undefined ? null : JSON.stringify(value)
    }
    // No prototype means no host `Function` constructor to climb from.
    Object.setPrototypeOf(bridge, null)
    return bridge
  }

  /** Create the hardened context and install the bindings once per session. */
  private createSession(sessionId: string): ActSession {
    const placeholder: ActSession = {
      context: undefined as unknown as vm.Context,
      sink: { written: [], logs: [] },
    }
    const sandbox = Object.create(null) as Record<string, unknown>
    const context = vm.createContext(sandbox, {
      name: `zcd-browser-act-${sessionId}`,
      codeGeneration: { strings: false, wasm: false },
    })
    placeholder.context = context
    this.sessions.set(sessionId, placeholder)
    const install = vm.runInContext(BOOTSTRAP, context) as (bridge: unknown) => void
    install(this.bridge(sessionId, () => this.sessions.get(sessionId)?.sink))
    return placeholder
  }

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
    const record = this.sessions.get(sessionId) ?? this.createSession(sessionId)
    const sink: Sink = { written: [], logs: [] }
    record.sink = sink

    const script = compileBody(code, { repl: true })

    let value: unknown
    try {
      const pending = script.runInContext(record.context, { timeout: 5_000 }) as Promise<unknown>
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

    const resultText = value === undefined ? sink.written.join('\n') : serialize(value)
    const stdout = sink.logs.join('\n')
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
