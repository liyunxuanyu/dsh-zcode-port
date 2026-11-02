/**
 * `ctx.deferredTools` — the deferred-tool seam.
 *
 * Tools register normally; this service adds a per-step `when` condition backed
 * by a session projection. A tool therefore stays out of every model request
 * until the owning session loads it through `tool_search`, and the load
 * survives resume/fork because it is an appended session event.
 *
 * @module @zcd/deferred-tools
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { z as zod } from 'zod'
import type {} from '@zcd/shared/events'
import type { DeferredToolEntry, DeferredToolMeta, DeferredToolSeam } from './types.js'

export type * from './types.js'

/** Projection key holding the names one session has loaded. */
export const LOADED_KEY = 'zcdDeferredTools'

declare module '@deepseek-ai/cordis' {
  interface Context {
    deferredTools: DeferredToolsService
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Deferred tool names admitted for the owning session. */
    zcdDeferredTools: string[]
  }
}

const loadedSchema = zod.array(zod.string())

interface CatalogRow {
  readonly definition: ToolDefinition
  readonly meta: DeferredToolMeta
}

/**
 * Registry of deferred tools plus the per-session loaded policy.
 */
export class DeferredToolsService extends Service implements DeferredToolSeam {
  static inject = ['tools', 'sessionProjections']

  private readonly catalog = new Map<string, CatalogRow>()
  private projectionReady = false

  constructor(ctx: Context) {
    super(ctx, 'deferredTools')
  }

  protected async [Service.init](): Promise<void> {
    await this.ctx.sessionProjections.register<'zcdDeferredTools', string[]>({
      key: LOADED_KEY,
      stateSchema: loadedSchema,
      init: () => [],
      apply: (state, event) => {
        if (event.type !== 'deferred-tool/loaded') return state
        return state.includes(event.data.name) ? state : [...state, event.data.name]
      },
      wire: { viewSchema: loadedSchema, view: state => state, summary: false },
      stateVersion: 1,
    })
    this.projectionReady = true
  }

  /**
   * Register a deferred tool.
   * @param definition - complete tool definition.
   * @param meta - group, keywords, always-visible flag.
   * @returns disposer removing the catalog row and the tool registration.
   */
  register(definition: ToolDefinition, meta: DeferredToolMeta): () => void {
    if (this.catalog.has(definition.name)) {
      throw new Error(`deferred tool "${definition.name}" is already registered`)
    }
    const row: CatalogRow = { definition, meta }
    this.catalog.set(definition.name, row)
    const off = this.ctx.tools.register(definition, {
      when: ({ agent }) => {
        if (meta.alwaysVisible === true) return true
        return this.loaded(agent.session).has(definition.name)
      },
    })
    return () => {
      this.catalog.delete(definition.name)
      off()
    }
  }

  /**
   * Catalog rows for one agent, with loaded flags.
   * @param agent - the viewing agent.
   * @returns rows in registration order.
   */
  entries(agent: { session: Session }): DeferredToolEntry[] {
    const loaded = this.loaded(agent.session)
    return [...this.catalog.entries()].map(([name, row]) => ({
      name,
      group: row.meta.group,
      description: row.definition.description ?? '',
      keywords: row.meta.keywords ?? [],
      loaded: loaded.has(name),
    }))
  }

  /**
   * Whether a name is deferred and still pending for this agent.
   * @param agent - the viewing agent.
   * @param name - tool name.
   * @returns true when the tool exists but is not loaded.
   */
  isPending(agent: { session: Session }, name: string): boolean {
    return this.catalog.has(name) && !this.loaded(agent.session).has(name)
  }

  /**
   * Mark one tool loaded for a session by appending the durable event.
   * @param session - owning session.
   * @param name - tool name.
   * @param query - optional search query for audit.
   */
  markLoaded(session: Session, name: string, query?: string): void {
    if (this.loaded(session).has(name)) return
    session.append('deferred-tool/loaded', {
      name,
      ...(query === undefined ? {} : { query }),
      at: Date.now(),
    })
  }

  /**
   * Read the loaded set for a session.
   * @param session - owning session.
   * @returns names already loaded.
   */
  private loaded(session: Session): Set<string> {
    if (!this.projectionReady) return new Set()
    const snapshot = this.ctx.sessionProjections.snapshot(session, [LOADED_KEY])
    return new Set(snapshot.values.zcdDeferredTools ?? [])
  }
}

export default DeferredToolsService
