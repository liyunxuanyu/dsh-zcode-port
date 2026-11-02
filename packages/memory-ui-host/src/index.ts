/**
 * User-memory management for the ZCD settings page.
 *
 * Only the user scope is exposed: it needs no workspace, so the global
 * settings page can manage it without inventing a session. Project memory
 * stays model/tool-driven where the session cwd is known.
 *
 * @module @zcd/memory-ui-host
 */

import type { IncomingMessage } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@zcd/memory'

export const name = 'zcd-memory-ui-host'
export const inject = ['webServer', 'memory']

/** Read a bounded JSON body. */
async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > 128 * 1024) throw new Error('body too large')
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
 * Register `/zcd/memory`.
 * @param ctx - context carrying the web server and the memory service.
 */
export function apply(ctx: Context): void {
  ctx.webServer.register({
    kind: 'prefix',
    path: '/zcd/memory',
    handler(req, res) {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname === '/zcd/memory') {
        if (req.method === 'GET') {
          const entries = ctx.memory.list('user', undefined).map(entry => ({
            id: entry.id,
            name: entry.name,
            description: entry.description,
            type: entry.type,
            updatedAt: entry.updatedAt,
          }))
          json(res, 200, { entries })
          return
        }
        if (req.method === 'POST') {
          void readJson(req).then(body => {
            const value = body as {
              name?: unknown
              description?: unknown
              type?: unknown
              body?: unknown
            }
            if (typeof value.name !== 'string' || typeof value.body !== 'string'
              || typeof value.description !== 'string'
              || (value.type !== 'fact' && value.type !== 'preference' && value.type !== 'decision' && value.type !== 'reference')) {
              json(res, 400, { error: 'invalid-body' })
              return
            }
            try {
              const entry = ctx.memory.write({
                scope: 'user',
                name: value.name,
                description: value.description,
                type: value.type,
                body: value.body,
              }, {})
              json(res, 201, { entry })
            } catch (error: unknown) {
              json(res, 400, { error: error instanceof Error ? error.message : 'write-failed' })
            }
          }, (error: unknown) => {
            json(res, 400, { error: error instanceof Error ? error.message : 'invalid-body' })
          })
          return
        }
        res.writeHead(405, { allow: 'GET, POST' })
        res.end()
        return
      }

      const id = /^\/zcd\/memory\/([A-Za-z0-9_-]+)$/.exec(url.pathname)?.[1]
      if (id !== undefined && req.method === 'DELETE') {
        try {
          ctx.memory.remove(id, 'user', undefined)
          json(res, 200, { removed: true, id })
        } catch (error: unknown) {
          json(res, 404, { error: error instanceof Error ? error.message : 'not-found' })
        }
        return
      }
      res.writeHead(404)
      res.end()
    },
  })
}
