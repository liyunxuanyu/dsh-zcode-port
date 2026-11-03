/**
 * Live browser panel surface for the ZCD sidebar.
 *
 * Two read-only routes keyed by session id:
 *
 * - `GET /zcd/browser/live?session=…` — attachment mode plus the tab list.
 * - `GET /zcd/browser/frame?session=…` — the active page as a PNG.
 *
 * The panel polls the frame route; each response is `no-store` so a browser
 * cache never shows a stale page. Only http(s) sessions reach here, because
 * the browser service resolves the session's own page.
 *
 * @module @zcd/browser-ui-host
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@zcd/browser'

export const name = 'zcd-browser-ui-host'
export const inject = ['webServer', 'browser']

/**
 * Register the routes.
 * @param ctx - context carrying the web server and the browser service.
 */
export function apply(ctx: Context): void {
  ctx.webServer.register({
    kind: 'prefix',
    path: '/zcd/browser',
    handler(req, res) {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (req.method !== 'GET') {
        res.writeHead(405, { allow: 'GET' })
        res.end()
        return
      }
      // The panel is not session-scoped, so it asks which sessions own a browser.
      if (url.pathname === '/zcd/browser/sessions') {
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        })
        res.end(JSON.stringify({ sessions: ctx.browser.browserSessions() }))
        return
      }

      const session = url.searchParams.get('session') ?? ''
      if (session.trim().length === 0) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'session is required' }))
        return
      }

      if (url.pathname === '/zcd/browser/live') {
        void ctx.browser.liveState(session).then(state => {
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          })
          res.end(JSON.stringify(state))
        }, error => {
          res.writeHead(503, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'browser-unavailable' }))
        })
        return
      }

      if (url.pathname === '/zcd/browser/frame') {
        void ctx.browser.liveFrame(session, { maxWidth: 960 }).then(png => {
          res.writeHead(200, {
            'content-type': 'image/png',
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
            'content-length': String(png.length),
          })
          res.end(png)
        }, error => {
          res.writeHead(503, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'browser-unavailable' }))
        })
        return
      }

      res.writeHead(404)
      res.end()
    },
  })
}
