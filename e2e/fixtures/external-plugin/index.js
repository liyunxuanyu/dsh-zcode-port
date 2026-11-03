/**
 * External-plugin fixture.
 *
 * This package is deliberately *not* part of the workspace: it stands in for a
 * third-party dsh plugin that an operator installs into the product profile.
 * It depends only on the Cordis context contract (a `webServer` service) and
 * exposes one exact route, which is how the end-to-end test proves it really
 * loaded — a plugin that merely resolves but never activates serves nothing.
 *
 * @module @zcd-e2e/probe
 */

export const name = 'zcd-e2e-probe'

export const inject = ['webServer']

/**
 * Register the probe route.
 * @param ctx - context carrying the host web server.
 */
export function apply(ctx) {
  ctx.webServer.register({
    kind: 'exact',
    path: '/e2e-probe/health',
    handler(req, res) {
      if (req.method !== 'GET') {
        res.writeHead(405, { allow: 'GET' })
        res.end()
        return
      }
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(JSON.stringify({ ok: true, plugin: name, version: '1.0.0' }))
    },
  })
}
