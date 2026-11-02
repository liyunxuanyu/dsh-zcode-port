/**
 * `browser_*` — deferred browser tools over `@zcd/browser`.
 *
 * The tool set is deliberately small: navigate, read the accessibility tree,
 * click, type, screenshot, and close. It is the browser half of the ZCode
 * browser-use skill, rewritten for dsh's tool pipeline instead of the original
 * `js` + `agent.browsers` object model. Every tool is deferred so the catalog
 * stays small until the model needs a browser.
 *
 * @module @zcd/tool-browser
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@zcd/browser'
import type {} from '@zcd/deferred-tools'

export const name = 'zcd-tool-browser'
export const inject = ['tools', 'deferredTools', 'browser']

/** Resolve the owning session id and page. */
function sessionId(exec: { agent?: { session: { id: unknown } } }): string {
  const agent = exec.agent
  if (agent === undefined) throw new Error('browser tools require an owning agent session')
  return String(agent.session.id)
}

/**
 * Register the browser tools.
 * @param ctx - context carrying tools, the deferred seam, and the browser.
 */
export function apply(ctx: Context): void {
  const offOpen = ctx.deferredTools.register(defineTool({
    name: 'browser_open',
    description:
      'Open an absolute http(s) URL in the session browser and return the page title and final URL. '
      + 'Only http and https are allowed; local file and data URLs are rejected. Read the page with '
      + 'browser_snapshot before acting.',
    parameters: {
      url: { type: 'string', required: true, description: 'Absolute http(s) URL.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string', required: true },
          title: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Opened ${value.title === '' ? '(untitled)' : value.title} at ${value.url}`,
      }],
    },
    async execute(args, exec) {
      const page = await ctx.browser.page(sessionId(exec))
      const response = await page.goto(args.url, { waitUntil: 'domcontentloaded' })
      return {
        url: page.url() || response?.url() || args.url,
        title: await page.title(),
      }
    },
  }), { group: 'browser', keywords: ['open', 'navigate', 'goto', 'url', 'page'] })

  const offSnapshot = ctx.deferredTools.register(defineTool({
    name: 'browser_snapshot',
    description:
      'Read the current page as an accessibility tree with roles, names, and states. This is the '
      + 'primary way to decide what to click or type. Returns a truncated flag when the tree is too large.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string', required: true },
          title: { type: 'string', required: true },
          text: { type: 'string', required: true },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.title} (${value.url}${value.truncated ? ', truncated' : ''}):\n${value.text}`,
      }],
    },
    async execute(_args, exec) {
      const page = await ctx.browser.page(sessionId(exec))
      const full = await page.locator('body').ariaSnapshot().catch(() => '')
      const limit = 20_000
      return {
        url: page.url(),
        title: await page.title(),
        text: full.length > limit ? full.slice(0, limit) : full,
        truncated: full.length > limit,
      }
    },
  }), { group: 'browser', keywords: ['snapshot', 'accessibility', 'dom', 'read', 'inspect'] })

  const offEvaluate = ctx.deferredTools.register(defineTool({
    name: 'browser_evaluate',
    description:
      'Execute JavaScript in the current page and return its JSON result as text. Use an expression or '
      + 'an async IIFE, for example `(async () => ({ title: document.title }))()`. It runs in the page, '
      + 'not in Node: no filesystem, no require, no tool calls. Prefer browser_snapshot for reading and '
      + 'this tool for bulk extraction or a multi-step DOM interaction.',
    parameters: {
      code: { type: 'string', required: true, description: 'JavaScript expression or async IIFE.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          result: { type: 'string', required: true },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Page result${value.truncated ? ' (truncated)' : ''}: ${value.result}`,
      }],
    },
    async execute(args, exec) {
      const page = await ctx.browser.page(sessionId(exec))
      const value = await page.evaluate(args.code)
      let text: string
      try {
        text = JSON.stringify(value, null, 2) ?? 'null'
      } catch {
        text = String(value)
      }
      const limit = 60_000
      return {
        result: text.length > limit ? text.slice(0, limit) : text,
        truncated: text.length > limit,
      }
    },
  }), { group: 'browser', keywords: ['evaluate', 'javascript', 'script', 'extract', 'dom'] })

  const offClick = ctx.deferredTools.register(defineTool({
    name: 'browser_click',
    description:
      'Click one element identified by a Playwright selector proven from browser_snapshot. '
      + 'Strict: the selector must resolve to exactly one element.',
    parameters: {
      selector: { type: 'string', required: true, description: 'Playwright selector, for example role=button[name="Save"].' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { selector: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `Clicked ${value.selector}` }],
    },
    async execute(args, exec) {
      const page = await ctx.browser.page(sessionId(exec))
      await page.locator(args.selector).click()
      return { selector: args.selector }
    },
  }), { group: 'browser', keywords: ['click', 'press', 'button', 'link'] })

  const offType = ctx.deferredTools.register(defineTool({
    name: 'browser_type',
    description:
      'Fill one input identified by a Playwright selector and optionally press Enter. '
      + 'Use browser_snapshot first to prove the selector.',
    parameters: {
      selector: { type: 'string', required: true, description: 'Playwright selector for the input.' },
      text: { type: 'string', required: true, description: 'Text to enter.' },
      submit: { type: 'boolean', description: 'Press Enter after filling (default false).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          selector: { type: 'string', required: true },
          submitted: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Filled ${value.selector}${value.submitted ? ' and pressed Enter' : ''}`,
      }],
    },
    async execute(args, exec) {
      const page = await ctx.browser.page(sessionId(exec))
      const input = page.locator(args.selector)
      await input.fill(args.text)
      if (args.submit === true) await input.press('Enter')
      return { selector: args.selector, submitted: args.submit === true }
    },
  }), { group: 'browser', keywords: ['type', 'fill', 'input', 'form', 'enter'] })

  const offScreenshot = ctx.deferredTools.register(defineTool({
    name: 'browser_screenshot',
    description:
      'Save a PNG of the current page to the host storage directory and return its path. '
      + 'Use for visual checks; the image is not embedded in the tool result.',
    parameters: {
      full_page: { type: 'boolean', description: 'Capture the full scroll height (default false).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { path: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `Screenshot saved to ${value.path}` }],
    },
    async execute(args, exec) {
      const path = await ctx.browser.screenshot(sessionId(exec), { fullPage: args.full_page === true })
      return { path }
    },
  }), { group: 'browser', keywords: ['screenshot', 'capture', 'image', 'png'] })

  const offClose = ctx.deferredTools.register(defineTool({
    name: 'browser_close',
    description: 'Close the session browser page and release its context. Safe when nothing is open.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { closed: { type: 'boolean', required: true } },
      },
      render: () => [{ type: 'text', text: 'Browser page closed.' }],
    },
    async execute(_args, exec) {
      await ctx.browser.closeSession(sessionId(exec))
      return { closed: true }
    },
  }), { group: 'browser', keywords: ['close', 'dispose', 'browser'] })

  ctx.effect(() => () => {
    offOpen()
    offSnapshot()
    offEvaluate()
    offClick()
    offType()
    offScreenshot()
    offClose()
  }, 'zcd-tool-browser: deferred registrations')
}
