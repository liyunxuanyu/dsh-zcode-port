/**
 * Sandboxed HTTP surface for Gen UI artifacts.
 *
 * The model writes one self-contained HTML file per visualization; this route
 * serves it under a strict CSP and an iframe sandbox. The page cannot call a
 * tool, read cookies, fetch, or navigate the host. Artifact ids are random, so
 * a page is only reachable by someone who already has the link.
 *
 * @module @zcd/genui-host
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

export const name = 'zcd-genui-host'
export const inject = ['webServer']

/** Deployment configuration. */
export interface Config {
  /** Artifact root; defaults to `$DSH_HOME/storages/zcd-genui`. */
  root?: string
}

const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
  'sandbox allow-scripts',
].join('; ')

/**
 * Register the `/zcd/genui` route.
 * @param ctx - context carrying the web server.
 * @param config - artifact root override.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const root = config.root ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'storages', 'zcd-genui')
  ctx.webServer.register({
    kind: 'prefix',
    path: '/zcd/genui',
    handler(req, res) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD' })
        res.end()
        return
      }
      const url = new URL(req.url ?? '/', 'http://localhost')
      const match = /^\/zcd\/genui\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/.exec(url.pathname)
      if (match === null) {
        res.writeHead(404)
        res.end()
        return
      }
      const sessionId = match[1] ?? ''
      const artifactId = match[2] ?? ''
      if (sessionId === '' || artifactId === '') {
        res.writeHead(404)
        res.end()
        return
      }
      const file = join(root, sessionId, `${artifactId}.html`)
      if (!existsSync(file)) {
        res.writeHead(404)
        res.end()
        return
      }
      const body = readFileSync(file)
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': CSP,
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      })
      res.end(req.method === 'HEAD' ? undefined : body)
    },
  })
}
