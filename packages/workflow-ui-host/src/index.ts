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
      if (url.pathname === '/zcd/workflow/runs') {
        if (req.method !== 'GET') {
          res.writeHead(405, { allow: 'GET' })
          res.end()
          return
        }
        const runs = ctx.durableWorkflow.list(50).map(run => ({
          id: run.id,
          name: run.name,
          status: run.status,
          nodeCount: run.nodeCount,
          updatedAt: run.updatedAt,
        }))
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        })
        res.end(JSON.stringify({ runs }))
        return
      }
      const match = /^\/zcd\/workflow\/runs\/([A-Za-z0-9_-]+)(\/cancel|\/resume|\/nodes|\/events)?$/.exec(url.pathname)
      const id = match?.[1]
      const sub = match?.[2]
      const cancel = sub === '/cancel'
      const resume = sub === '/resume'
      if (id === undefined) {
        res.writeHead(404)
        res.end()
        return
      }
      if (sub === '/events') {
        if (req.method !== 'GET') {
          res.writeHead(405, { allow: 'GET' })
          res.end()
          return
        }
        try {
          const events = ctx.durableWorkflow.events(id).slice(-200).map(event => ({
            at: event.at,
            type: event.type,
            data: event.data,
          }))
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          })
          res.end(JSON.stringify({ events }))
          return
        } catch {
          res.writeHead(404, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'not-found' }))
          return
        }
      }
      if (sub === '/nodes') {
        if (req.method !== 'GET') {
          res.writeHead(405, { allow: 'GET' })
          res.end()
          return
        }
        try {
          const nodes = ctx.durableWorkflow.nodes(id).map(node => ({
            id: node.nodeId,
            index: node.index,
            status: node.status,
            prompt: node.prompt.slice(0, 160),
            output: node.output?.slice(0, 240),
            error: node.error,
          }))
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          })
          res.end(JSON.stringify({ nodes }))
          return
        } catch {
          res.writeHead(404, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'not-found' }))
          return
        }
      }
      if (cancel || resume) {
        if (req.method !== 'POST') {
          res.writeHead(405, { allow: 'POST' })
          res.end()
          return
        }
        try {
          if (cancel) ctx.durableWorkflow.cancel(id)
          else ctx.durableWorkflow.resumeFromStore(id)
        } catch (error: unknown) {
          res.writeHead(cancel ? 404 : 409, { 'content-type': 'application/json' })
          res.end(JSON.stringify({
            error: error instanceof Error ? error.message : (cancel ? 'not-found' : 'resume-failed'),
          }))
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
