/**
 * Gen UI tool card: render a `visualize` result as a sandboxed iframe.
 *
 * Hand-written in dsh's lazy-CJS factory format so this package needs no
 * browser build step. The URL is read from the tool's text result; the page is
 * served by @zcd/genui-host under its own CSP, and the iframe sandbox removes
 * same-origin access as a second layer.
 */
window.__ModuleLoader__.load({
  id: '@zcd/client-ui-genui',
  factory: (require) => {
    const React = require('react')
    const { jsx } = require('react/jsx-runtime')

    /** Extract the first Gen UI path from the tool result text. */
    function genUiUrl(props) {
      const content = Array.isArray(props.block?.content) ? props.block.content : []
      const text = content
        .filter((item) => item && item.type === 'text' && typeof item.text === 'string')
        .map((item) => item.text)
        .join('\n')
      const match = /\/zcd\/genui\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+/.exec(text)
      return match === null ? undefined : match[0]
    }

    /** Card body: title + iframe, or a short pending row. */
    function GenUiCard(props) {
      const url = props.phase === 'result' ? genUiUrl(props) : undefined
      if (url === undefined) {
        return jsx('div', {
          'data-tool': 'visualize',
          style: { padding: '8px 10px', color: 'var(--text-secondary, #666)', fontSize: '12px' },
          children: props.phase === 'result' ? 'Gen UI result did not include a page URL.' : 'Rendering page…',
        })
      }
      const height = props.block?.args?.number?.('height') ?? 480
      return jsx('div', {
        'data-tool': 'visualize',
        style: { border: '1px solid var(--border, #ddd)', borderRadius: '8px', overflow: 'hidden' },
        children: jsx('iframe', {
          src: url,
          sandbox: 'allow-scripts',
          title: 'Gen UI',
          style: { display: 'block', width: '100%', height: `${Math.max(240, Math.min(10000, height))}px`, border: '0' },
        }),
      })
    }

    /** Register the keyed tool view. */
    function apply(ctx) {
      ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
        name: 'tool.call.toolview',
        key: 'visualize',
      }, GenUiCard))
    }

    const module = { exports: {} }
    module.exports.apply = apply
    module.exports.inject = ['slots']
    return module.exports
  },
})
