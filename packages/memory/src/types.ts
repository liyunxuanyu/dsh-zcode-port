/**
 * Long-term memory vocabulary.
 *
 * @module @zcd/memory/types
 */

/** Where one memory lives. */
export type MemoryScope = 'project' | 'user'

/** What kind of fact an entry records. */
export type MemoryType = 'fact' | 'preference' | 'decision' | 'reference'

/** One memory entry. */
export interface MemoryEntry {
  readonly id: string
  readonly scope: MemoryScope
  readonly name: string
  readonly description: string
  readonly type: MemoryType
  readonly body: string
  readonly updatedAt: number
}
