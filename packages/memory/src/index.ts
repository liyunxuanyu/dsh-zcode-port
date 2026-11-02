/**
 * `ctx.memory` — project and user long-term memory.
 *
 * Files are the source of truth: one Markdown entry per fact with a small
 * frontmatter, plus a generated `MEMORY.md` index. The service owns path
 * containment, size limits, secret rejection, and soft deletion. It never
 * injects memory into a prompt by itself; consumers decide what to read.
 *
 * @module @zcd/memory
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@zcd/shared/events'
import type { MemoryEntry, MemoryScope, MemoryType } from './types.js'

export type * from './types.js'

/** Deployment configuration. */
export interface Config {
  /** Maximum bytes for one entry body. */
  maxEntryBytes: number
  /** Maximum entries per scope. */
  maxEntries: number
  /** Directory name under the workspace and the home. */
  directoryName: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    memory: MemoryService
  }
}

const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /ghp_[A-Za-z0-9]{30,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
]

const TYPES = new Set<MemoryType>(['fact', 'preference', 'decision', 'reference'])

/** Lowercase, hyphenated, filesystem-safe slug. */
export function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return base.length === 0 ? 'entry' : base.slice(0, 60)
}

/** Parse one entry file. */
export function parseEntry(scope: MemoryScope, id: string, text: string): MemoryEntry | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (match === null) return undefined
  const fields = new Map<string, string>()
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim())
  }
  const name = fields.get('name')
  const description = fields.get('description') ?? ''
  const type = fields.get('type') as MemoryType | undefined
  if (name === undefined || type === undefined || !TYPES.has(type)) return undefined
  return {
    id,
    scope,
    name,
    description,
    type,
    body: (match[2] ?? '').trim(),
    updatedAt: Number(fields.get('updated') ?? 0),
  }
}

/** Render one entry file. */
export function renderEntry(entry: MemoryEntry): string {
  return [
    '---',
    `name: ${entry.name}`,
    `description: ${entry.description}`,
    `type: ${entry.type}`,
    `updated: ${entry.updatedAt}`,
    '---',
    '',
    entry.body,
    '',
  ].join('\n')
}

/** Reject content that looks like a credential. */
export function assertNoSecrets(text: string): void {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      throw new Error('memory_write refused: content looks like a credential; store a reference instead')
    }
  }
}

/**
 * File-backed memory service.
 */
export class MemoryService extends Service {
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'memory')
  }

  protected [Service.init](): void {
    // One scoped section per agent, so the index belongs to that agent's cwd.
    // Subagents skip it: their cwd is the parent's, and the parent already
    // carries the index; duplicating it only spends context.
    this.ctx.on('agent/created', ({ agent }): undefined => {
      if (agent.session.header.origin === 'subagent') return undefined
      const cwd = agent.session.header.cwd
      if (cwd === undefined) return undefined
      agent.ctx.systemPrompt.section({
        name: 'zcd:memory:index',
        order: 2950,
        text: () => {
          const index = this.index('project', cwd).trim()
          if (index.length === 0) return ''
          return `# Project memory (index)

${index}

Use memory_search and memory_read before asking the user to repeat a preference, decision, or fact.`
        },
      })
      return undefined
    })
  }

  /**
   * Resolve one scope's root.
   * @param scope - project or user.
   * @param cwd - workspace directory for the project scope.
   * @returns absolute root.
   */
  root(scope: MemoryScope, cwd: string | undefined): string {
    if (scope === 'user') return join(homedir(), this.config.directoryName)
    if (cwd === undefined) throw new Error('project memory requires a session working directory')
    return join(cwd, this.config.directoryName)
  }

  /**
   * Ensure one directory is inside the scope root.
   * @param root - scope root.
   * @param path - candidate path.
   * @returns absolute path.
   */
  private contained(root: string, path: string): string {
    const absoluteRoot = resolve(root)
    const absolute = resolve(path)
    if (absolute !== absoluteRoot && !absolute.startsWith(absoluteRoot + sep)) {
      throw new Error('memory path escapes its scope root')
    }
    return absolute
  }

  /**
   * List entries in one scope.
   * @param scope - project or user.
   * @param cwd - workspace directory for the project scope.
   * @returns entries sorted by name.
   */
  list(scope: MemoryScope, cwd: string | undefined): MemoryEntry[] {
    const entriesDir = this.contained(this.root(scope, cwd), join(this.root(scope, cwd), 'entries'))
    if (!existsSync(entriesDir)) return []
    const out: MemoryEntry[] = []
    for (const file of readdirSync(entriesDir)) {
      if (!file.endsWith('.md')) continue
      const entry = parseEntry(scope, file.slice(0, -3), readFileSync(join(entriesDir, file), 'utf8'))
      if (entry !== undefined) out.push(entry)
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Search all entries for a literal query.
   * @param query - literal text, case-insensitive.
   * @param opts - scopes, cwd, and limit.
   * @returns matching entries, best first.
   */
  search(query: string, opts: { scopes: MemoryScope[]; cwd?: string; limit: number }): MemoryEntry[] {
    const needle = query.trim().toLowerCase()
    if (needle.length === 0) return []
    const scored: { entry: MemoryEntry; score: number }[] = []
    for (const scope of opts.scopes) {
      for (const entry of this.list(scope, opts.cwd)) {
        const name = entry.name.toLowerCase()
        const description = entry.description.toLowerCase()
        const body = entry.body.toLowerCase()
        let score = 0
        if (name.includes(needle)) score += 100
        if (description.includes(needle)) score += 40
        if (body.includes(needle)) score += 10
        if (score > 0) scored.push({ entry, score })
      }
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, opts.limit).map(row => row.entry)
  }

  /**
   * Read one entry by id.
   * @param id - entry id.
   * @param scope - project or user.
   * @param cwd - workspace directory for the project scope.
   * @returns the entry, or undefined.
   */
  read(id: string, scope: MemoryScope, cwd: string | undefined): MemoryEntry | undefined {
    const file = this.contained(this.root(scope, cwd), join(this.root(scope, cwd), 'entries', `${id}.md`))
    if (!existsSync(file)) return undefined
    return parseEntry(scope, id, readFileSync(file, 'utf8'))
  }

  /**
   * Write one entry, replacing an entry with the same name.
   * @param input - entry fields.
   * @param opts - cwd for the project scope.
   * @returns the stored entry.
   */
  write(input: {
    scope: MemoryScope
    name: string
    description: string
    type: MemoryType
    body: string
  }, opts: { cwd?: string }): MemoryEntry {
    const name = input.name.trim()
    const body = input.body.trim()
    if (name.length === 0) throw new Error('memory_write requires a name')
    if (body.length === 0) throw new Error('memory_write requires a body')
    if (Buffer.byteLength(body, 'utf8') > this.config.maxEntryBytes) {
      throw new Error(`memory entry exceeds ${this.config.maxEntryBytes} bytes`)
    }
    assertNoSecrets(`${name}
${input.description}
${body}`)
    const existing = this.list(input.scope, opts.cwd).find(entry => entry.name === name)
    if (existing === undefined && this.list(input.scope, opts.cwd).length >= this.config.maxEntries) {
      throw new Error(`memory scope is full (${this.config.maxEntries} entries); remove an entry first`)
    }
    const root = this.root(input.scope, opts.cwd)
    const entriesDir = this.contained(root, join(root, 'entries'))
    mkdirSync(entriesDir, { recursive: true })
    const id = existing?.id ?? slugify(name)
    const entry: MemoryEntry = {
      id,
      scope: input.scope,
      name,
      description: input.description.trim(),
      type: input.type,
      body,
      updatedAt: Date.now(),
    }
    writeFileSync(this.contained(root, join(entriesDir, `${id}.md`)), renderEntry(entry))
    this.rebuildIndex(input.scope, opts.cwd)
    return entry
  }

  /**
   * Soft-delete one entry.
   * @param id - entry id.
   * @param scope - project or user.
   * @param cwd - workspace directory for the project scope.
   */
  remove(id: string, scope: MemoryScope, cwd: string | undefined): void {
    const root = this.root(scope, cwd)
    const file = this.contained(root, join(root, 'entries', `${id}.md`))
    if (!existsSync(file)) throw new Error(`memory entry ${id} does not exist`)
    const trash = this.contained(root, join(root, '.trash'))
    mkdirSync(trash, { recursive: true })
    renameSync(file, join(trash, `${id}-${Date.now()}.md`))
    this.rebuildIndex(scope, cwd)
  }

  /**
   * Rebuild `MEMORY.md` from the entries on disk.
   * @param scope - project or user.
   * @param cwd - workspace directory for the project scope.
   * @returns the rendered index.
   */
  rebuildIndex(scope: MemoryScope, cwd: string | undefined): string {
    const root = this.root(scope, cwd)
    const entries = this.list(scope, cwd)
    const lines = [
      '# Memory',
      '',
      ...entries.slice(0, 50).map(entry =>
        `- [${entry.name}](entries/${entry.id}.md) — ${entry.description}`),
      '',
    ]
    mkdirSync(root, { recursive: true })
    writeFileSync(this.contained(root, join(root, 'MEMORY.md')), lines.join('\n'))
    return lines.join('\n')
  }

  /**
   * Deterministically tidy one scope: drop unparseable entries, keep the
   * newest entry per name, and rebuild the index. This is the no-model half of
   * "dream"; an LLM summary can be layered on later without changing it.
   * @param scope - project or user.
   * @param cwd - workspace directory for the project scope.
   * @returns counters for the report.
   */
  dream(scope: MemoryScope, cwd: string | undefined): { scanned: number; removed: number; kept: number } {
    const root = this.root(scope, cwd)
    const entriesDir = this.contained(root, join(root, 'entries'))
    if (!existsSync(entriesDir)) return { scanned: 0, removed: 0, kept: 0 }
    const trash = this.contained(root, join(root, '.trash'))
    const byName = new Map<string, MemoryEntry>()
    let scanned = 0
    let removed = 0
    for (const file of readdirSync(entriesDir)) {
      if (!file.endsWith('.md')) continue
      scanned++
      const path = join(entriesDir, file)
      const entry = parseEntry(scope, file.slice(0, -3), readFileSync(path, 'utf8'))
      if (entry === undefined) {
        mkdirSync(trash, { recursive: true })
        renameSync(path, join(trash, `${file.slice(0, -3)}-${Date.now()}.md`))
        removed++
        continue
      }
      const previous = byName.get(entry.name)
      if (previous === undefined || entry.updatedAt > previous.updatedAt) {
        if (previous !== undefined) {
          mkdirSync(trash, { recursive: true })
          renameSync(join(entriesDir, `${previous.id}.md`), join(trash, `${previous.id}-${Date.now()}.md`))
          removed++
        }
        byName.set(entry.name, entry)
      } else {
        mkdirSync(trash, { recursive: true })
        renameSync(path, join(trash, `${entry.id}-${Date.now()}.md`))
        removed++
      }
    }
    this.rebuildIndex(scope, cwd)
    return { scanned, removed, kept: byName.size }
  }

  /**
   * Read the generated index, if present.
   * @param scope - project or user.
   * @param cwd - workspace directory for the project scope.
   * @returns index text or an empty string.
   */
  index(scope: MemoryScope, cwd: string | undefined): string {
    const file = join(this.root(scope, cwd), 'MEMORY.md')
    return existsSync(file) ? readFileSync(file, 'utf8') : ''
  }
}

export default MemoryService
