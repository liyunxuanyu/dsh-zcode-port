/**
 * ZCD settings section: runtime identity and recent workflow runs.
 *
 * Reads the host's read-only `/zcd/status` route; nothing here writes config.
 */
window.__ModuleLoader__.load({
  id: '@zcd/client-ui-settings-zcd',
  factory: (require) => {
    const React = require('react')
    const { jsx } = require('react/jsx-runtime')

    const cell = { padding: '4px 0', fontSize: '12px', color: 'var(--text-secondary, #555)' }
    const mono = { fontFamily: 'var(--font-mono, monospace)' }

    /** Section body. */
    function ZcdSettings() {
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
      return jsx('div', { style: { display: 'grid', gap: '10px' } }, [
        jsx('div', { key: 'identity', style: cell, children: [
          jsx('div', { key: 'p', children: `Product: ${status.product}` }),
          jsx('div', { key: 'n', children: `Node ${status.node} · dsh ${status.dsh}` }),
          jsx('div', { key: 'u', children: `Uptime ${status.uptimeSeconds}s` }),
        ] }),
        jsx('div', { key: 'runs', children: [
          jsx('div', { key: 'h', style: { fontWeight: 600, fontSize: '13px', marginBottom: '4px' }, children: 'Recent workflow runs' }),
          runs.length === 0
            ? jsx('div', { key: 'empty', style: cell, children: 'No runs yet.' })
            : jsx('div', { key: 'list', style: { display: 'grid', gap: '4px' } }, runs.map((run) => jsx('div', {
              key: run.id,
              style: cell,
              children: jsx('span', { style: mono, children: `${run.id} [${run.status}] ${run.name} · ${run.nodeCount} nodes` }),
            }))),
        ] }),
      ])
    }

    /** Register the settings section. */
    function apply(ctx) {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'zcd',
        order: 30,
        label: () => 'ZCD',
      }, ZcdSettings))
    }

    const module = { exports: {} }
    module.exports.apply = apply
    module.exports.inject = ['slots']
    return module.exports
  },
})
