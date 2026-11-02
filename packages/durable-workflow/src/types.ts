/**
 * Durable workflow vocabulary (MVP).
 *
 * @module @zcd/durable-workflow/types
 */

import type { RunStatus } from '@zcd/workflow-store'

export type { RunStatus } from '@zcd/workflow-store'

/** Everything the model supplies to start a run. */
export interface WorkflowStartRequest {
  /** Plain JavaScript body; `return` ends the run. */
  readonly script: string
  /** Display label. */
  readonly name?: string
  /** Value exposed to the script as `args`. */
  readonly args?: unknown
}

/** One run as returned to tools and callers. */
export interface WorkflowRunView {
  readonly id: string
  readonly name: string
  readonly status: RunStatus
  readonly script: string
  readonly args: unknown
  readonly createdAt: number
  readonly updatedAt: number
  readonly nodeCount: number
  readonly result?: unknown
  readonly error?: { code: string; message: string }
}
