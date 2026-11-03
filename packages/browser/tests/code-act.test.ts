import { describe, expect, it } from 'vitest'
import { BrowserCodeAct, type CodeActHost } from '../src/code-act.js'

/** A fake page/host that records calls and returns canned values. */
function host(overrides: Partial<CodeActHost> = {}): CodeActHost & { calls: string[] } {
  const calls: string[] = []
  const page = {
    goto: async (url: string) => { calls.push(`goto:${url}`) },
    locator: () => ({
      ariaSnapshot: async () => 'button "Save"',
      click: async () => { calls.push('click') },
      fill: async (text: string) => { calls.push(`fill:${text}`) },
      press: async (key: string) => { calls.push(`press:${key}`) },
      waitFor: async () => { calls.push('waitFor') },
    }),
    evaluate: async (code: string) => ({ code }),
    url: () => 'https://example.com/',
    title: async () => 'Example',
  }
  return {
    calls,
    page: async () => page,
    screenshot: async () => '/tmp/shot.png',
    listTabs: async () => [{ id: 'tab-1', url: 'https://example.com/', title: 'Example', active: true }],
    newTab: async (_sessionId, url) => ({ id: 'tab-2', url: url ?? 'about:blank', title: '' }),
    switchTab: async () => { calls.push('switchTab') },
    closeTab: async () => { calls.push('closeTab') },
    ...overrides,
  }
}

describe('browser code-act runner', () => {
  it('returns the last expression and supports await on bindings', async () => {
    const fake = host()
    const runner = new BrowserCodeAct(fake)
    const out = await runner.run('session-1', {
      title: 'open',
      code: 'const page = await goto("https://example.com/"); return page.title',
    })
    expect(out.result).toBe('Example')
    expect(out.truncated).toBe(false)
    expect(fake.calls).toContain('goto:https://example.com/')
  })

  it('collects write() and console output', async () => {
    const fake = host()
    const runner = new BrowserCodeAct(fake)
    const out = await runner.run('session-1', {
      title: 'inspect',
      code: 'console.log("a", 1); write("b"); snapshot()',
    })
    expect(out.result).toBe('button "Save"')
    expect(out.stdout).toBe('a 1')
  })

  it('falls back to write() output when the script returns nothing', async () => {
    const out = await new BrowserCodeAct(host()).run('session-1', {
      title: 'tabs',
      code: 'write(await tabs())',
    })
    expect(out.result).toContain('tab-1')
  })

  it('persists state and globalThis across calls but not call-local bindings', async () => {
    const runner = new BrowserCodeAct(host())
    await runner.run('s', { title: 'a', code: 'var local = 41; globalThis.shared = 41; state.count = 1' })
    const out = await runner.run('s', { title: 'b', code: 'state.count += globalThis.shared; state.count' })
    expect(out.result).toBe('42')
    const local = await runner.run('s', { title: 'c', code: 'typeof local' })
    expect(local.result).toBe('undefined')
  })

  it('keeps sessions isolated', async () => {
    const runner = new BrowserCodeAct(host())
    await runner.run('left', { title: 'a', code: 'state.shared = "left"' })
    const right = await runner.run('right', { title: 'b', code: 'typeof state.shared' })
    expect(right.result).toBe('undefined')
  })

  it('refuses Node-level escapes: no require, process, fetch, or timers', async () => {
    const runner = new BrowserCodeAct(host())
    for (const probe of ['typeof require', 'typeof process', 'typeof fetch', 'typeof setTimeout']) {
      const out = await runner.run('s', { title: 'probe', code: probe })
      expect(out.result).toBe('undefined')
    }
  })

  it('caps the combined output and flags truncation', async () => {
    const runner = new BrowserCodeAct(host(), { maxOutputChars: 50 })
    const out = await runner.run('s', { title: 'big', code: '"x".repeat(200)' })
    expect(out.result).toHaveLength(50)
    expect(out.truncated).toBe(true)
  })

  it('parses failures and runtime errors into readable messages', async () => {
    const runner = new BrowserCodeAct(host())
    await expect(runner.run('s', { title: 'bad', code: 'this is not javascript' }))
      .rejects.toThrow(/could not parse/)
    await expect(runner.run('s', { title: 'throw', code: 'throw new Error("boom")' }))
      .rejects.toThrow(/boom/)
    await expect(runner.run('s', { title: 'empty', code: '   ' }))
      .rejects.toThrow(/must not be empty/)
  })

  it('drops a session context on reset', async () => {
    const runner = new BrowserCodeAct(host())
    await runner.run('s', { title: 'a', code: 'state.shared = 1' })
    runner.reset('s')
    const out = await runner.run('s', { title: 'b', code: 'typeof state.shared' })
    expect(out.result).toBe('undefined')
  })

  it('calls click/type/waitFor through the page bindings', async () => {
    const fake = host()
    const out = await new BrowserCodeAct(fake).run('s', {
      title: 'form',
      code: 'await click("#go"); await type("#name", "zcd", { submit: true }); await waitFor("#out"); "done"',
    })
    expect(out.result).toBe('done')
    expect(fake.calls).toEqual(['click', 'fill:zcd', 'press:Enter', 'waitFor'])
  })
})
