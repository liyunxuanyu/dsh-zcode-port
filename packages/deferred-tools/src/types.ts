/**
 * Public vocabulary of the deferred-tool seam.
 *
 * A deferred tool is registered exactly like any other tool, but it enters a
 * model step only after its owning session loaded it through search. The seam
 * owns that policy so individual tools stay unaware of it.
 *
 * @module @zcd/deferred-tools/types
 */

import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

/** Deployment metadata for one deferred tool. */
export interface DeferredToolMeta {
  /** Display group, e.g. `browser`, `office`, `workflow`, `memory`. */
  readonly group: string
  /** Extra search terms beyond the tool name and description. */
  readonly keywords?: readonly string[]
  /**
   * Keep the tool visible without a search. Used by small, high-frequency
   * tools where the extra schema costs less than a round trip.
   */
  readonly alwaysVisible?: boolean
}

/** One catalog row as shown to the model and the UI. */
export interface DeferredToolEntry {
  readonly name: string
  readonly group: string
  readonly description: string
  readonly keywords: readonly string[]
  /** Whether this session already loaded the tool. */
  readonly loaded: boolean
}

/** What the seam exposes to other plugins. */
export interface DeferredToolSeam {
  /**
   * Register a tool that stays out of model steps until loaded.
   * @param definition - complete tool definition, exactly as `ctx.tools.register` expects.
   * @param meta - deployment classification and search terms.
   * @returns the disposer that removes both the registration and its catalog row.
   */
  register(definition: ToolDefinition, meta: DeferredToolMeta): () => void

  /** Catalog rows for one agent's view, including loaded flags. */
  entries(agent: { session: { id: string } }): DeferredToolEntry[]

  /** Whether one name is deferred and not yet loaded for this agent. */
  isPending(agent: { session: { id: string } }, name: string): boolean
}
