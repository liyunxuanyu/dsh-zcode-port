/**
 * Read-only status JSON for the ZCD settings page.
 *
 * Exposes runtime identity and the recent workflow summaries. No secrets,
 * no paths, no script bodies.
 *
 * @module @zcd/status-host
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@zcd/durable-workflow'

export const name = 'zcd-status-host'
export const inject = ['webServer']

/**
 * Register `/zcd/status`.
 * @param ctx - context carrying the web server and the workflow engine.
 */
export function apply(ctx: Context): void {
  ctx.webServer.register({
    kind: 'exact',
    path: '/zcd/status',
    handler(req, res) {
      if (req.method !== 'GET') {
        res.writeHead(405, { allow: 'GET' })
        res.end()
        return
      }
      const runs = ctx.get('durableWorkflow')?.list(10).map(run => ({
        id: run.id,
        name: run.name,
        status: run.status,
        nodeCount: run.nodeCount,
      })) ?? []
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      })
      res.end(JSON.stringify({
        product: 'ZCD',
        node: process.version,
        dsh: '0.2.2-alpha.2',
        uptimeSeconds: Math.floor(process.uptime()),
        runs,
      }))
    },
  })
}
