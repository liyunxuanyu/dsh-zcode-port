/**
 * HTTP surface for the document view registry.
 *
 * POST records what the browser opened; GET lets a client or a smoke test read
 * it back. Only paths and anchors, never file bytes.
 *
 * @module @zcd/documents-ui-host
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@zcd/document-view'

export const name = 'zcd-documents-ui-host'
export const inject = ['webServer', 'documentView']

/** Read a bounded JSON body. */
async function readJson(req: import('node:http').IncomingMessage): Promise<unknown> {
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

/**
 * Register `/zcd/documents/view`.
 * @param ctx - context carrying the web server and the registry.
 */
export function apply(ctx: Context): void {
  ctx.webServer.register({
    kind: 'exact',
    path: '/zcd/documents/view',
    handler(req, res) {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (req.method === 'GET') {
        const sessionId = url.searchParams.get('sessionId') ?? ''
        const view = ctx.documentView.get(sessionId)
        res.writeHead(view === undefined ? 404 : 200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        })
        res.end(JSON.stringify(view === undefined ? { error: 'not-found' } : view))
        return
      }
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'GET, POST' })
        res.end()
        return
      }
      void readJson(req).then(body => {
        const value = body as { sessionId?: unknown; path?: unknown; anchor?: unknown }
        if (typeof value.sessionId !== 'string' || typeof value.path !== 'string') {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'invalid-body' }))
          return
        }
        ctx.documentView.record(value.sessionId, {
          path: value.path,
          ...(typeof value.anchor === 'string' ? { anchor: value.anchor } : {}),
        })
        res.writeHead(204)
        res.end()
      }, (error: unknown) => {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'invalid-body' }))
      })
    },
  })
}
