/**
 * ZCD settings section: runtime identity and recent workflow runs.
 *
 * Reads the host's read-only `/zcd/status` route; nothing here writes config.
 */
window.__ModuleLoader__.load({
  id: '@zcd/client-ui-settings-zcd',
  factory: (require) => {
    const React = require('react')
    const { jsx, jsxs } = require('react/jsx-runtime')

    const cell = { padding: '4px 0', fontSize: '12px', color: 'var(--text-secondary, #555)' }
    const mono = { fontFamily: 'var(--font-mono, monospace)' }

    /** Section body. */
    function ZcdSettings(props) {
      const [status, setStatus] = React.useState(undefined)
      const [error, setError] = React.useState(undefined)
      React.useEffect(() => {
        let alive = true
        fetch('/zcd/status')
          .then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status))))
          .then((value) => { if (alive) setStatus(value) })
          .catch((reason) => { if (alive) setError(String(reason?.message ?? reason)) })
        return () => { alive = false }
      }, [])
      if (error !== undefined) {
        return jsx('div', { style: cell, children: `ZCD status unavailable (${error}).` })
      }
      if (status === undefined) {
        return jsx('div', { style: cell, children: 'Loading ZCD status…' })
      }
      const runs = Array.isArray(status.runs) ? status.runs : []
      const identity = jsxs('div', { style: cell, children: [
        jsx('div', { children: `Product: ${status.product}` }),
        jsx('div', { children: `Node ${status.node} · dsh ${status.dsh}` }),
        jsx('div', { children: `Uptime ${status.uptimeSeconds}s` }),
        props.openPanel === undefined ? null : jsx('button', {
          type: 'button',
          style: { marginTop: '6px', border: '1px solid var(--border, #ccc)', background: 'transparent', color: 'inherit', borderRadius: '6px', padding: '2px 8px', cursor: 'pointer', fontSize: '12px' },
          onClick: () => props.openPanel(),
          children: 'Open workflow panel',
        }),
      ] })
      const runRows = runs.map((run) => jsx('div', {
        key: run.id,
        style: cell,
        children: jsx('span', {
          style: mono,
          children: `${run.id} [${run.status}] ${run.name} · ${run.nodeCount} nodes`,
        }),
      }))
      const runsBlock = jsxs('div', { children: [
        jsx('div', {
          style: { fontWeight: 600, fontSize: '13px', marginBottom: '4px' },
          children: 'Recent workflow runs',
        }),
        runs.length === 0
          ? jsx('div', { style: cell, children: 'No runs yet.' })
          : jsxs('div', { style: { display: 'grid', gap: '4px' }, children: runRows }),
      ] })
      return jsxs('div', { style: { display: 'grid', gap: '10px' }, children: [identity, runsBlock] })
    }

    /** Register the settings section. */
    function apply(ctx) {
      const NS = 'zcd.settings'
      ctx.effect(() => ctx.locale.register(NS, {
        zh: { nav: 'ZCD' },
        en: { nav: 'ZCD' },
      }), 'zcd-settings: dictionary')
      const t = ctx.locale.bind(NS)
      const Body = (props) => ZcdSettings({ ...props, openPanel: () => ctx.sidebarRight.openTab('zcd-workflow') })
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'zcd',
        order: 30,
        locale: NS,
        label: () => t('nav'),
      }, Body))
    }

    const module = { exports: {} }
    module.exports.apply = apply
    module.exports.inject = ['slots', 'locale', 'sidebarRight']
    return module.exports
  },
})
