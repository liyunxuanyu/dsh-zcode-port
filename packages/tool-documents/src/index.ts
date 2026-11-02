/**
 * `read_document` / `search_document` — addressable text from workspace files.
 *
 * Both tools resolve paths against the calling session's cwd and refuse to
 * escape it. They extract text only; opening a viewer is a separate client
 * concern and is not claimed here.
 *
 * @module @zcd/tool-documents
 */

import { resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@zcd/deferred-tools'
import type {} from '@zcd/document-view'
import { extractDocument, type DocUnit } from './extract.js'

export const name = 'zcd-tool-documents'
export const inject = ['tools', 'deferredTools', 'documentView']

const unitSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    anchor: { type: 'string', required: true },
    text: { type: 'string', required: true },
  },
} as const

/**
 * Resolve one model-supplied path inside the session cwd.
 * @param cwd - session working directory.
 * @param input - relative or absolute path.
 * @returns the absolute path.
 */
function inside(cwd: string, input: string): string {
  const absolute = resolve(cwd, input)
  if (absolute !== cwd && !absolute.startsWith(cwd + sep)) {
    throw new Error('document path escapes the session working directory')
  }
  return absolute
}

/**
 * Render units with anchors.
 * @param units - extracted units.
 * @returns model-facing text.
 */
function render(units: readonly DocUnit[]): string {
  return units.map(unit => `${unit.anchor} ${unit.text}`).join('\n')
}

/**
 * Register the document tools through the deferred seam.
 * @param ctx - context carrying tools and the seam.
 */
export function apply(ctx: Context): void {
  const offRead = ctx.deferredTools.register(defineTool({
    name: 'read_document',
    description:
      'Read a workspace document as addressable text: text/Markdown by line, Word by paragraph '
      + '(`#p:n`), Excel by row (`#s:Sheet!A1`), PDF by page (`#page:n`). Read-only; paths must stay '
      + 'inside the session working directory.',
    parameters: {
      path: { type: 'string', required: true, description: 'Workspace-relative or absolute path.' },
      max_units: { type: 'integer', description: 'Maximum addressable units (default 2000).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          kind: { type: 'string', required: true, enum: ['text', 'docx', 'xlsx', 'pdf'] },
          units: { type: 'array', required: true, items: unitSchema },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.path} (${value.kind}${value.truncated ? ', truncated' : ''}):\n${render(value.units)}`,
      }],
    },
    async execute(args, exec) {
      const cwd = exec.agent?.session.header.cwd
      if (cwd === undefined) throw new Error('read_document requires a session working directory')
      const path = inside(cwd, args.path)
      const extract = await extractDocument(path, {
        maxUnits: Math.max(1, Math.min(5000, args.max_units ?? 2000)),
        maxChars: 200_000,
      })
      return { path, kind: extract.kind, units: [...extract.units], truncated: extract.truncated }
    },
  }), { group: 'documents', keywords: ['document', 'docx', 'xlsx', 'pdf', 'read', 'text'] })

  const offSearch = ctx.deferredTools.register(defineTool({
    name: 'search_document',
    description:
      'Search a workspace document for literal text and return matching units with their anchors. '
      + 'Use read_document when you need the surrounding text.',
    parameters: {
      path: { type: 'string', required: true },
      query: { type: 'string', required: true, description: 'Literal text, case-insensitive.' },
      limit: { type: 'integer', description: 'Maximum matches (default 20).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          matches: { type: 'array', required: true, items: unitSchema },
          total: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.matches.length === 0
          ? `No match in ${value.path}.`
          : `${value.total} matches in ${value.path}:\n${render(value.matches)}`,
      }],
    },
    async execute(args, exec) {
      const cwd = exec.agent?.session.header.cwd
      if (cwd === undefined) throw new Error('search_document requires a session working directory')
      const path = inside(cwd, args.path)
      const extract = await extractDocument(path, { maxUnits: 5000, maxChars: 200_000 })
      const needle = args.query.toLowerCase()
      const all = extract.units.filter(unit => unit.text.toLowerCase().includes(needle))
      const limit = Math.max(1, Math.min(100, args.limit ?? 20))
      return { path, matches: all.slice(0, limit), total: all.length }
    },
  }), { group: 'documents', keywords: ['search', 'find', 'grep', 'document'] })

  const offOpen = ctx.deferredTools.register(defineTool({
    name: 'open_document',
    description:
      "Open a workspace document in the document viewer. The file must stay inside the "
      + 'session working directory. Use read_document when you need the text.',
    parameters: {
      path: { type: 'string', required: true, description: 'Workspace-relative or absolute path.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { path: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `Opened ${value.path} in the document viewer.` }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      const cwd = agent?.session.header.cwd
      if (agent === undefined || cwd === undefined) throw new Error('open_document requires a session working directory')
      const path = inside(cwd, args.path)
      ctx.documentView.record(String(agent.session.id), { path })
      return { path }
    },
  }), { group: 'documents', keywords: ['open', 'viewer', 'document'] })

  const offShow = ctx.deferredTools.register(defineTool({
    name: 'show_in_viewer',
    description:
      'Open a workspace document and reveal a location. Supports a line anchor (#l:12) for text '
      + 'and Markdown; other formats open at the beginning.',
    parameters: {
      path: { type: 'string', required: true },
      anchor: { type: 'string', required: true, description: 'Anchor such as #l:12, #p:3, #page:2.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          line: { type: 'integer' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Opened ${value.path}${value.line === undefined ? '' : ` at line ${value.line}`}.`,
      }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      const cwd = agent?.session.header.cwd
      if (agent === undefined || cwd === undefined) throw new Error('show_in_viewer requires a session working directory')
      const path = inside(cwd, args.path)
      const line = /^#l:(\d+)$/.exec(args.anchor.trim())?.[1]
      ctx.documentView.record(String(agent.session.id), { path, anchor: args.anchor })
      return {
        path,
        ...(line === undefined ? {} : { line: Number(line) }),
      }
    },
  }), { group: 'documents', keywords: ['reveal', 'anchor', 'line', 'viewer'] })

  const offGet = ctx.deferredTools.register(defineTool({
    name: 'get_view',
    description:
      'Read the document the user most recently opened in this session, with its anchor when one '
      + 'was requested. Returns not-found when no document was opened.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          anchor: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Current document: ${value.path}${value.anchor === undefined ? '' : ` (${value.anchor})`}`,
      }],
    },
    async execute(_args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('get_view requires an owning agent session')
      const view = ctx.documentView.get(String(agent.session.id))
      if (view === undefined) throw new Error('no document has been opened in this session')
      return {
        path: view.path,
        ...(view.anchor === undefined ? {} : { anchor: view.anchor }),
      }
    },
  }), { group: 'documents', keywords: ['view', 'current', 'document', 'opened'] })

  ctx.effect(() => () => { offRead(); offSearch(); offOpen(); offShow(); offGet() }, 'zcd-tool-documents: deferred registrations')
}
