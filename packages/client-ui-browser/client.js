/**
 * Live browser panel: a sidebar tab that mirrors the controlled Chrome.
 *
 * The tab is not session-scoped, so it asks the host which sessions own a
 * browser and lets the user pick one. The frame is polled as a PNG while the
 * tab is open and every request is `no-store`, so a stale image can never be
 * mistaken for the current page. Nothing here drives the browser: this is a
 * viewer on top of the same session the agent is already using.
 */
window.__ModuleLoader__.load({
  id: '@zcd/client-ui-browser',
  factory: (require) => {
    const React = require('react')
    const { jsx, jsxs } = require('react/jsx-runtime')

    const ID = '@zcd/client-ui-browser'
    const KIND = 'zcd-browser'
    const NS = 'zcd.browser'

    const cell = { padding: '4px 0', fontSize: '12px', color: 'var(--text-secondary, #555)' }
    const mono = { fontFamily: 'var(--font-mono, monospace)' }
    const selectStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid var(--border, #ccc)', background: 'transparent', color: 'inherit', borderRadius: '6px', padding: '4px 6px', fontSize: '12px' }

    /** Panel body: session picker, tab list, and a polling frame. */
    function BrowserPanel() {
      const [sessions, setSessions] = React.useState([])
      const [session, setSession] = React.useState(undefined)
      const [state, setState] = React.useState(undefined)
      const [error, setError] = React.useState(undefined)
      const [tick, setTick] = React.useState(0)

      React.useEffect(() => {
        let alive = true
        const read = () => {
          fetch('/zcd/browser/sessions')
            .then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status))))
            .then((value) => {
              if (!alive) return
              const list = Array.isArray(value.sessions) ? value.sessions : []
              setSessions(list)
              setError(undefined)
              setSession((current) => current !== undefined && list.includes(current) ? current : list[0])
            })
            .catch((reason) => { if (alive) setError(String(reason?.message ?? reason)) })
        }
        read()
        const timer = setInterval(read, 3000)
        return () => { alive = false; clearInterval(timer) }
      }, [])

      React.useEffect(() => {
        if (session === undefined) return undefined
        let alive = true
        fetch(`/zcd/browser/live?session=${encodeURIComponent(session)}`)
          .then((response) => response.ok ? response.json() : response.json()
            .then((value) => Promise.reject(new Error(value.error ?? String(response.status))))
            .catch((reason) => Promise.reject(reason instanceof Error ? reason : new Error(String(response.status)))))
          .then((value) => { if (alive) { setState(value); setError(undefined) } })
          .catch((reason) => { if (alive) { setState(undefined); setError(String(reason?.message ?? reason)) } })
        return () => { alive = false }
      }, [session, tick])

      React.useEffect(() => {
        if (session === undefined) return undefined
        const timer = setInterval(() => setTick((value) => value + 1), 1500)
        return () => clearInterval(timer)
      }, [session])

      if (error !== undefined && sessions.length === 0) {
        return jsx('div', { style: { padding: '12px' }, children: `Browser unavailable (${error}).` })
      }
      if (sessions.length === 0) {
        return jsxs('div', { style: { padding: '12px', display: 'grid', gap: '6px' }, children: [
          jsx('div', { style: { fontWeight: 600, fontSize: '13px' }, children: 'Live browser' }),
          jsx('div', { style: cell, children: 'No browser session is open yet. The panel appears once the agent opens a page.' }),
        ] })
      }

      const tabs = state?.tabs ?? []
      const mode = state?.mode === 'attached' ? 'attached to your Chrome' : 'headless Chrome'
      return jsxs('div', { style: { display: 'grid', gap: '8px', padding: '12px' }, children: [
        jsx('div', { style: { fontWeight: 600, fontSize: '13px' }, children: 'Live browser' }),
        jsx('select', {
          value: session ?? '',
          onChange: (event) => setSession(event.target.value),
          style: selectStyle,
          children: sessions.map((id) => jsx('option', { key: id, value: id, children: id })),
        }),
        jsx('div', { style: cell, children: `${mode} · ${tabs.length} tab${tabs.length === 1 ? '' : 's'}` }),
        error === undefined ? null : jsx('div', { style: { ...cell, color: 'var(--red, #b00)' }, children: error }),
        jsx('img', {
          key: `${session}-${tick}`,
          src: `/zcd/browser/frame?session=${encodeURIComponent(session)}&t=${tick}`,
          alt: 'Live browser frame',
          style: { width: '100%', border: '1px solid var(--border, #ccc)', borderRadius: '6px', background: '#000' },
        }),
        ...tabs.map((tab) => jsx('div', {
          key: tab.id,
          style: { ...cell, ...mono, fontSize: '11px', overflowWrap: 'anywhere' },
          children: `${tab.active ? '*' : ' '} ${tab.id} ${tab.title || '(untitled)'} ${tab.url}`,
        })),
      ] })
    }

    /** Register the tab type, its dictionary, and its body. */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, {
        zh: { title: '浏览器' },
        en: { title: 'Browser' },
      }), 'zcd-browser: dictionary')
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: ID,
        kind: KIND,
        title: () => t('title'),
      }), 'zcd-browser: tab type')
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: ID,
        locale: NS,
      }, BrowserPanel)), 'zcd-browser: tab body')
    }

    const module = { exports: {} }
    module.exports.apply = apply
    module.exports.inject = ['slots', 'locale', 'sidebarRightTabs']
    return module.exports
  },
})
