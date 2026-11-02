/**
 * Read-only JSON surface for the workflow card.
 *
 * One route, keyed by an unguessable run id. It exposes the same fields the
 * `workflow_get_run` tool returns (without the script) so the browser can poll
 * a run without a second Remote API.
 *
 * @module @zcd/workflow-ui-host
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@zcd/durable-workflow'

export const name = 'zcd-workflow-ui-host'
export const inject = ['webServer', 'durableWorkflow']

/**
 * Register the route.
 * @param ctx - context carrying the web server and the engine.
 */
export function apply(ctx: Context): void {
  ctx.webServer.register({
    kind: 'prefix',
    path: '/zcd/workflow/runs',
    handler(req, res) {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const match = /^\/zcd\/workflow\/runs\/([A-Za-z0-9_-]+)(\/cancel)?$/.exec(url.pathname)
      const id = match?.[1]
      const cancel = match?.[2] !== undefined
      if (id === undefined) {
        res.writeHead(404)
        res.end()
        return
      }
      if (cancel) {
        if (req.method !== 'POST') {
          res.writeHead(405, { allow: 'POST' })
          res.end()
          return
        }
        try {
          ctx.durableWorkflow.cancel(id)
        } catch {
          res.writeHead(404, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'not-found' }))
          return
        }
      } else if (req.method !== 'GET') {
        res.writeHead(405, { allow: 'GET' })
        res.end()
        return
      }
      let run
      try {
        run = ctx.durableWorkflow.get(id)
      } catch {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'not-found' }))
        return
      }
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      })
      res.end(JSON.stringify({
        id: run.id,
        name: run.name,
        status: run.status,
        nodeCount: run.nodeCount,
        result: run.result,
        error: run.error,
        holes: run.holes,
      }))
    },
  })
}
