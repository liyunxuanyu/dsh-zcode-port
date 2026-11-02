/**
 * ZCD tool cards: document rows with an Open action, and a workflow run row.
 *
 * `openFile` is dsh's host callback; for docx/pptx/xlsx/pdf it opens the
 * built-in document preview, which already converts Office files to PDF.
 */
window.__ModuleLoader__.load({
  id: '@zcd/client-ui-zcd',
  factory: (require) => {
    const React = require('react')
    const { jsx } = require('react/jsx-runtime')

    const rowStyle = {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '6px 10px',
      fontSize: '12px',
      color: 'var(--text-secondary, #555)',
    }
    const buttonStyle = {
      marginLeft: 'auto',
      border: '1px solid var(--border, #ccc)',
      background: 'transparent',
      color: 'inherit',
      borderRadius: '6px',
      padding: '2px 8px',
      cursor: 'pointer',
      fontSize: '12px',
    }

    /** Document tool row: path + Open. */
    function DocumentRow(props) {
      const path = props.block?.args?.text?.('path') ?? ''
      if (path === '') return null
      return jsx('div', {
        'data-tool': 'read_document',
        style: rowStyle,
        children: [
          jsx('span', { key: 'path', style: { fontFamily: 'var(--font-mono, monospace)' }, children: path }),
          jsx('button', {
            key: 'open',
            type: 'button',
            style: buttonStyle,
            onClick: () => {
              try {
                Promise.resolve(props.openFile?.(path)).catch(() => {})
              } catch {
                // The host reports its own open failure; the row stays usable.
              }
            },
            children: 'Open',
          }),
        ],
      })
    }

    /** Workflow row: run id and live status from the host route. */
    function WorkflowRow(props) {
      const content = Array.isArray(props.block?.content) ? props.block.content : []
      const text = content
        .filter((item) => item && item.type === 'text' && typeof item.text === 'string')
        .map((item) => item.text)
        .join(' ')
      const id = /run-[A-Za-z0-9-]+/.exec(text)?.[0]
      const [status, setStatus] = React.useState(undefined)
      React.useEffect(() => {
        if (id === undefined) return undefined
        let alive = true
        const read = () => {
          fetch(`/zcd/workflow/runs/${id}`)
            .then((response) => response.ok ? response.json() : undefined)
            .then((value) => { if (alive && value !== undefined) setStatus(value.status) })
            .catch(() => {})
        }
        read()
        const timer = setInterval(read, 2000)
        return () => { alive = false; clearInterval(timer) }
      }, [id])
      if (text === '' && id === undefined) return null
      return jsx('div', {
        'data-tool': 'workflow_run',
        style: rowStyle,
        children: jsx('span', { children: status === undefined ? text : `${id} [${status}]` }),
      })
    }

    /** Register the three keyed tool views. */
    function apply(ctx) {
      const register = (key, component) => ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
        name: 'tool.call.toolview',
        key,
      }, component))
      register('read_document', DocumentRow)
      register('search_document', DocumentRow)
      register('workflow_run', WorkflowRow)
    }

    const module = { exports: {} }
    module.exports.apply = apply
    module.exports.inject = ['slots']
    return module.exports
  },
})
