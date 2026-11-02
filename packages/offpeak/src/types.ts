/**
 * Off-peak task vocabulary.
 *
 * @module @zcd/offpeak/types
 */

/** Terminal and intermediate states of one off-peak task. */
export type OffPeakStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'taken-over'
  | 'interrupted'

/** What a caller asks the scheduler to run later. */
export interface OffPeakTaskInput {
  /** Prompt submitted as the only user message of the task's first turn. */
  readonly prompt: string
  /** Short human label shown in lists and the settings page. */
  readonly title?: string
  /** Absolute workspace directory; defaults to the creating session's cwd. */
  readonly cwd?: string
  /** Minimum idle minutes before the task may start. */
  readonly idleMinutes?: number
}

/** One scheduled task, as observed by callers. */
export interface OffPeakTask {
  readonly id: string
  readonly status: OffPeakStatus
  readonly input: OffPeakTaskInput
  readonly sessionId?: string
  readonly createdAt: number
  readonly startedAt?: number
  readonly endedAt?: number
  readonly summary?: string
  readonly error?: { code: string; message: string }
}
