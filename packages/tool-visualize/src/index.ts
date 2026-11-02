/**
 * `visualize` — write one self-contained HTML page and return its sandbox URL.
 *
 * The page is served by `@zcd/genui-host` under a strict CSP. It has no tools,
 * no same-origin access, no network, and no host API; interactions stay local
 * unless the page asks the user to open a link. This is the dsh counterpart of
 * ZCode's Gen UI without a markdown directive parser.
 *
 * @module @zcd/tool-visualize
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@zcd/deferred-tools'

export const name = 'zcd-tool-visualize'
export const inject = ['tools', 'deferredTools']

/** Deployment configuration. */
export interface Config {
  /** Artifact root; must match the host route. */
  root?: string
  /** Maximum HTML bytes. */
  maxBytes?: number
}

const MAX_BYTES_DEFAULT = 2 * 1024 * 1024

/**
 * Register `visualize`.
 * @param ctx - context carrying tools and the deferred seam.
 * @param config - artifact root and size cap.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const root = config.root ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'storages', 'zcd-genui')
  const maxBytes = config.maxBytes ?? MAX_BYTES_DEFAULT

  const off = ctx.deferredTools.register(defineTool({
    name: 'visualize',
    description:
      'Render a self-contained interactive HTML page for the user (chart, diagram, table, small tool). '
      + 'Use inline CSS/JS only; external scripts, fonts, and network calls are blocked by the sandbox. '
      + 'The page cannot call tools. Returns a URL served under a strict CSP.',
    parameters: {
      html: { type: 'string', required: true, description: 'Complete HTML document, inline assets only.' },
      title: { type: 'string', required: true, description: 'Short title for the page.' },
      mode: { type: 'string', enum: ['inline', 'wide'], description: 'Preferred presentation width.' },
      height: { type: 'integer', description: 'Suggested height in pixels (240–10000).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          artifactId: { type: 'string', required: true },
          url: { type: 'string', required: true },
          title: { type: 'string', required: true },
          mode: { type: 'string', required: true, enum: ['inline', 'wide'] },
          height: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Rendered "${value.title}" (${value.mode}, ${value.height}px): ${value.url}`,
      }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('visualize requires an owning agent session')
      const bytes = Buffer.byteLength(args.html, 'utf8')
      if (bytes > maxBytes) throw new Error(`visualize HTML exceeds ${maxBytes} bytes (${bytes})`)
      const sessionId = String(agent.session.id).replace(/[^A-Za-z0-9_-]/g, '_')
      const artifactId = randomUUID().replaceAll('-', '')
      const dir = join(root, sessionId)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, `${artifactId}.html`), args.html)
      const mode: 'inline' | 'wide' = args.mode === 'wide' ? 'wide' : 'inline'
      const height = Math.max(240, Math.min(10_000, args.height ?? 480))
      return {
        artifactId,
        url: `/zcd/genui/${sessionId}/${artifactId}`,
        title: args.title,
        mode,
        height,
      }
    },
  }), { group: 'ui', keywords: ['visualize', 'chart', 'diagram', 'html', 'render'] })

  ctx.effect(() => off, 'zcd-tool-visualize: deferred registration')
}
