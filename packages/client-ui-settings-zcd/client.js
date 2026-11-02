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
    const headingStyle = { fontWeight: 600, fontSize: '13px', marginBottom: '4px' }
    const buttonStyle = { border: '1px solid var(--border, #ccc)', background: 'transparent', color: 'inherit', borderRadius: '6px', padding: '2px 8px', cursor: 'pointer', fontSize: '12px', width: 'fit-content' }
    const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid var(--border, #ccc)', background: 'transparent', color: 'inherit', borderRadius: '6px', padding: '4px 6px', fontSize: '12px' }

    /** Section body. */
    function ZcdSettings(props) {
      const [status, setStatus] = React.useState(undefined)
      const [error, setError] = React.useState(undefined)
      const [entries, setEntries] = React.useState([])
      const [name, setName] = React.useState('')
      const [description, setDescription] = React.useState('')
      const [type, setType] = React.useState('fact')
      const [body, setBody] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [message, setMessage] = React.useState(undefined)
      React.useEffect(() => {
        let alive = true
        fetch('/zcd/status')
          .then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status))))
          .then((value) => { if (alive) setStatus(value) })
          .catch((reason) => { if (alive) setError(String(reason?.message ?? reason)) })
        return () => { alive = false }
      }, [])
      const loadMemory = () => {
        fetch('/zcd/memory')
          .then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status))))
          .then((value) => { setEntries(Array.isArray(value.entries) ? value.entries : []) })
          .catch((reason) => { setMessage(String(reason?.message ?? reason)) })
      }
      React.useEffect(() => {
        let alive = true
        fetch('/zcd/memory')
          .then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status))))
          .then((value) => { if (alive) setEntries(Array.isArray(value.entries) ? value.entries : []) })
          .catch((reason) => { if (alive) setMessage(String(reason?.message ?? reason)) })
        return () => { alive = false }
      }, [])
      const submit = () => {
        if (name.trim() === '' || body.trim() === '') { setMessage('Name and body are required.'); return }
        setBusy(true)
        fetch('/zcd/memory', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, description, type, body }),
        })
          .then((response) => response.ok ? response.json() : response.json().then((value) => Promise.reject(new Error(value.error ?? String(response.status)))))
          .then(() => { setName(''); setDescription(''); setBody(''); setMessage('Saved.'); loadMemory() })
          .catch((reason) => setMessage(String(reason?.message ?? reason)))
          .finally(() => setBusy(false))
      }
      const remove = (id) => {
        setBusy(true)
        fetch(`/zcd/memory/${id}`, { method: 'DELETE' })
          .then((response) => response.ok ? undefined : Promise.reject(new Error(String(response.status))))
          .then(() => { setMessage('Removed.'); loadMemory() })
          .catch((reason) => setMessage(String(reason?.message ?? reason)))
          .finally(() => setBusy(false))
      }
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
          style: buttonStyle,
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
        jsx('div', { style: headingStyle, children: 'Recent workflow runs' }),
        runs.length === 0
          ? jsx('div', { style: cell, children: 'No runs yet.' })
          : jsxs('div', { style: { display: 'grid', gap: '4px' }, children: runRows }),
      ] })
      const entryRows = entries.map((entry) => jsxs('div', {
        key: entry.id,
        style: { ...cell, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' },
        children: [
          jsx('span', { style: { flex: 1, minWidth: 0, overflowWrap: 'anywhere' }, children: `[${entry.type}] ${entry.name} — ${entry.description}` }),
          jsx('button', {
            type: 'button',
            style: buttonStyle,
            disabled: busy,
            onClick: () => remove(entry.id),
            children: 'Delete',
          }),
        ],
      }))
      const memoryBlock = jsxs('div', { style: { display: 'grid', gap: '6px' }, children: [
        jsx('div', { style: headingStyle, children: 'User memory' }),
        entries.length === 0
          ? jsx('div', { style: cell, children: 'No user memory entries.' })
          : jsxs('div', { style: { display: 'grid', gap: '4px' }, children: entryRows }),
        jsx('input', { value: name, onChange: (event) => setName(event.target.value), placeholder: 'Name', style: inputStyle }),
        jsx('input', { value: description, onChange: (event) => setDescription(event.target.value), placeholder: 'Description', style: inputStyle }),
        jsxs('select', {
          value: type,
          onChange: (event) => setType(event.target.value),
          style: inputStyle,
          children: ['fact', 'preference', 'decision', 'reference'].map((value) => jsx('option', { key: value, value, children: value })),
        }),
        jsx('textarea', {
          value: body,
          onChange: (event) => setBody(event.target.value),
          placeholder: 'Body (Markdown)',
          rows: 3,
          style: { ...inputStyle, resize: 'vertical' },
        }),
        jsx('button', {
          type: 'button',
          style: buttonStyle,
          disabled: busy,
          onClick: submit,
          children: busy ? 'Saving…' : 'Add memory',
        }),
        message === undefined ? null : jsx('div', { style: cell, children: message }),
      ] })
      return jsxs('div', { style: { display: 'grid', gap: '14px' }, children: [identity, runsBlock, memoryBlock] })
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
