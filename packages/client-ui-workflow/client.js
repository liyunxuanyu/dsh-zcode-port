/**
 * Workflow run panel in the right Sidebar.
 *
 * Registers one page tab (`kind: 'zcd-workflow'`) whose body polls the host's
 * read-only run list. Opening the tab is a navigation action, so the panel
 * never starts a run by itself.
 */
window.__ModuleLoader__.load({
  id: '@zcd/client-ui-workflow',
  factory: (require) => {
    const React = require('react')
    const { jsx, jsxs } = require('react/jsx-runtime')

    const ID = '@zcd/client-ui-workflow'
    const KIND = 'zcd-workflow'
    const NS = 'zcd.workflow'

    const cell = { padding: '4px 0', fontSize: '12px', color: 'var(--text-secondary, #555)' }
    const mono = { fontFamily: 'var(--font-mono, monospace)' }
    const smallButton = { border: '1px solid var(--border, #ccc)', background: 'transparent', color: 'inherit', borderRadius: '6px', padding: '1px 6px', cursor: 'pointer', fontSize: '11px', width: 'fit-content' }
    const editorStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid var(--border, #ccc)', background: 'transparent', color: 'inherit', borderRadius: '6px', padding: '6px', fontSize: '11px', fontFamily: 'var(--font-mono, monospace)', resize: 'vertical' }

    /** Compact one-line event payload for the panel. */
    function summarize(data) {
      if (data === undefined) return ''
      const text = typeof data === 'string' ? data : JSON.stringify(data)
      if (text === undefined) return ''
      return ` · ${text.length > 90 ? `${text.slice(0, 90)}…` : text}`
    }

    /** Panel body: recent runs, refreshed every 3s; click a run for its nodes. */
    function WorkflowPanel() {
      const [runs, setRuns] = React.useState([])
      const [error, setError] = React.useState(undefined)
      const [expanded, setExpanded] = React.useState(undefined)
      const [nodes, setNodes] = React.useState({})
      const [events, setEvents] = React.useState({})
      const [refresh, setRefresh] = React.useState(0)
      const [actionError, setActionError] = React.useState(undefined)
      const [editing, setEditing] = React.useState(undefined)
      const [draft, setDraft] = React.useState('')
      const [draftName, setDraftName] = React.useState('')
      React.useEffect(() => {
        let alive = true
        const read = () => {
          fetch('/zcd/workflow/runs')
            .then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status))))
            .then((value) => { if (alive) { setRuns(Array.isArray(value.runs) ? value.runs : []); setError(undefined) } })
            .catch((reason) => { if (alive) setError(String(reason?.message ?? reason)) })
        }
        read()
        const timer = setInterval(read, 3000)
        return () => { alive = false; clearInterval(timer) }
      }, [refresh])
      const load = (id) => Promise.all([
        fetch(`/zcd/workflow/runs/${id}/nodes`).then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status)))),
        fetch(`/zcd/workflow/runs/${id}/events`).then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status)))),
      ]).then(([nodeValue, eventValue]) => {
        setNodes((previous) => ({ ...previous, [id]: Array.isArray(nodeValue.nodes) ? nodeValue.nodes : [] }))
        setEvents((previous) => ({ ...previous, [id]: Array.isArray(eventValue.events) ? eventValue.events : [] }))
      }).catch(() => {
        setNodes((previous) => ({ ...previous, [id]: [] }))
        setEvents((previous) => ({ ...previous, [id]: [] }))
      })
      const act = (id, action) => {
        setActionError(undefined)
        fetch(`/zcd/workflow/runs/${id}/${action}`, { method: 'POST' })
          .then((response) => response.ok ? undefined : response.json()
            .then((value) => Promise.reject(new Error(value.error ?? String(response.status))))
            .catch((reason) => Promise.reject(reason instanceof Error ? reason : new Error(String(response.status)))))
          .then(() => setRefresh((value) => value + 1))
          .catch((reason) => setActionError(String(reason?.message ?? reason)))
      }
      const beginAmend = (id) => {
        setActionError(undefined)
        fetch(`/zcd/workflow/runs/${id}`)
          .then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status))))
          .then((value) => {
            setEditing(id)
            setDraft(typeof value.script === 'string' ? value.script : '')
            setDraftName(typeof value.name === 'string' ? value.name : '')
          })
          .catch((reason) => setActionError(String(reason?.message ?? reason)))
      }
      const saveAmend = (id) => {
        setActionError(undefined)
        fetch(`/zcd/workflow/runs/${id}/amend`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ script: draft, name: draftName }),
        })
          .then((response) => response.ok ? response.json() : response.json()
            .then((value) => Promise.reject(new Error(value.error ?? String(response.status))))
            .catch((reason) => Promise.reject(reason instanceof Error ? reason : new Error(String(response.status)))))
          .then(() => { setEditing(undefined); setRefresh((value) => value + 1) })
          .catch((reason) => setActionError(String(reason?.message ?? reason)))
      }
      const toggle = (id) => {
        if (expanded === id) { setExpanded(undefined); return }
        setExpanded(id)
        void load(id)
      }
      if (error !== undefined) {
        return jsx('div', { style: { padding: '12px' }, children: `Workflow runs unavailable (${error}).` })
      }
      if (runs.length === 0) {
        return jsx('div', { style: { padding: '12px' }, children: 'No workflow runs yet.' })
      }
      return jsxs('div', { style: { display: 'grid', gap: '6px', padding: '12px' }, children: [
        jsx('div', { style: { fontWeight: 600, fontSize: '13px' }, children: 'Workflow runs' }),
        actionError === undefined ? null : jsx('div', { style: { ...cell, color: 'var(--red, #b00)' }, children: actionError }),
        ...runs.map((run) => {
          const nodeRows = expanded === run.id
            ? (nodes[run.id] ?? []).map((node) => jsx('div', {
              key: node.id,
              style: { ...cell, paddingLeft: '10px', fontSize: '11px' },
              children: `#${node.index} [${node.status}] ${node.prompt}`,
            }))
            : []
          const eventRows = expanded === run.id
            ? (events[run.id] ?? []).slice(-12).map((event, index) => jsx('div', {
              key: `${event.at}-${index}`,
              style: { ...cell, ...mono, paddingLeft: '10px', fontSize: '10px' },
              children: `${new Date(event.at).toLocaleTimeString()} ${event.type}${summarize(event.data)}`,
            }))
            : []
          return jsxs('div', {
            key: run.id,
            style: { ...cell, cursor: 'pointer' },
            onClick: () => toggle(run.id),
            children: [
              jsx('div', { style: mono, children: `${run.id} [${run.status}]` }),
              jsx('div', { children: `${run.name} · ${run.nodeCount} nodes` }),
              run.status === 'queued' || run.status === 'running'
                ? jsx('button', {
                  type: 'button',
                  style: smallButton,
                  onClick: (event) => { event.stopPropagation(); act(run.id, 'cancel') },
                  children: 'Cancel',
                })
                : null,
              run.status === 'failed' || run.status === 'interrupted' || run.status === 'cancelled'
                ? jsx('button', {
                  type: 'button',
                  style: smallButton,
                  onClick: (event) => { event.stopPropagation(); act(run.id, 'resume') },
                  children: 'Resume',
                })
                : null,
              run.status === 'succeeded' || run.status === 'failed'
                || run.status === 'interrupted' || run.status === 'cancelled'
                ? jsx('button', {
                  type: 'button',
                  style: smallButton,
                  onClick: (event) => { event.stopPropagation(); beginAmend(run.id) },
                  children: 'Amend',
                })
                : null,
              editing === run.id
                ? jsxs('div', {
                  style: { display: 'grid', gap: '6px', margin: '6px 0' },
                  onClick: (event) => event.stopPropagation(),
                  children: [
                    jsx('input', {
                      value: draftName,
                      onChange: (event) => setDraftName(event.target.value),
                      placeholder: 'Run name',
                      style: editorStyle,
                    }),
                    jsx('textarea', {
                      value: draft,
                      onChange: (event) => setDraft(event.target.value),
                      rows: 6,
                      style: editorStyle,
                    }),
                    jsxs('div', { style: { display: 'flex', gap: '6px' }, children: [
                      jsx('button', {
                        type: 'button',
                        style: smallButton,
                        onClick: () => saveAmend(run.id),
                        children: 'Save amend',
                      }),
                      jsx('button', {
                        type: 'button',
                        style: smallButton,
                        onClick: () => setEditing(undefined),
                        children: 'Cancel edit',
                      }),
                    ] }),
                  ],
                })
                : null,
              ...nodeRows,
              ...eventRows,
            ],
          })
        }),
      ] })
    }

    /** Register the tab type, its dictionary, and its body. */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, {
        zh: { title: '工作流' },
        en: { title: 'Workflows' },
      }), 'zcd-workflow: dictionary')
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: ID,
        kind: KIND,
        title: () => t('title'),
      }), 'zcd-workflow: tab type')
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: ID,
        locale: NS,
      }, WorkflowPanel)), 'zcd-workflow: tab body')
    }

    const module = { exports: {} }
    module.exports.apply = apply
    module.exports.inject = ['slots', 'locale', 'sidebarRightTabs']
    return module.exports
  },
})
