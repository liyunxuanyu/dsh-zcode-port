/**
 * Read/write surface for the ZCD runtime settings file, consumed by the ZCD
 * settings page.
 *
 * The route mirrors the service contract: `GET` returns every known key with
 * its effective value, `PATCH` validates and persists a partial patch, and
 * `POST /reset` drops every override. Unknown keys and wrong types are 400, so
 * a stale browser tab cannot silently write a value nothing understands.
 *
 * @module @zcd/settings-ui-host
 */

import type { IncomingMessage } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@zcd/runtime-settings'

export const name = 'zcd-settings-ui-host'
export const inject = ['webServer', 'runtimeSettings']

/** Read a bounded JSON body. */
async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > 64 * 1024) throw new Error('body too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** Send one JSON response. */
function json(res: import('node:http').ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(value))
}

/**
 * Register `/zcd/settings`.
 * @param ctx - context carrying the web server and the settings service.
 */
export function apply(ctx: Context): void {
  ctx.webServer.register({
    kind: 'prefix',
    path: '/zcd/settings',
    handler(req, res) {
      const url = new URL(req.url ?? '/', 'http://localhost')

      if (url.pathname === '/zcd/settings') {
        if (req.method === 'GET') {
          json(res, 200, { values: ctx.runtimeSettings.snapshot() })
          return
        }
        if (req.method === 'PATCH' || req.method === 'POST') {
          void readJson(req).then(body => {
            if (typeof body !== 'object' || body === null || Array.isArray(body)) {
              json(res, 400, { error: 'body must be an object' })
              return
            }
            try {
              json(res, 200, { values: ctx.runtimeSettings.update(body as Record<string, unknown>) })
            } catch (error: unknown) {
              json(res, 400, { error: error instanceof Error ? error.message : 'invalid-setting' })
            }
          }, (error: unknown) => {
            json(res, 400, { error: error instanceof Error ? error.message : 'invalid-body' })
          })
          return
        }
        res.writeHead(405, { allow: 'GET, PATCH, POST' })
        res.end()
        return
      }

      if (url.pathname === '/zcd/settings/reset') {
        if (req.method !== 'POST') {
          res.writeHead(405, { allow: 'POST' })
          res.end()
          return
        }
        json(res, 200, { values: ctx.runtimeSettings.reset() })
        return
      }

      res.writeHead(404)
      res.end()
    },
  })
}
