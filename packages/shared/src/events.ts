/**
 * ZCD session-event declarations.
 *
 * These events are additive: dsh's `SessionEventMap` is merge-extensible, and
 * every payload is lossless JSON. They carry ids and summaries only; bulk data
 * (workflow journals, memory bodies) lives in the owning store.
 *
 * @module @zcd/shared/events
 */

import type {} from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** One deferred tool became visible to the calling session. */
    'deferred-tool/loaded': {
      /** Registered tool name. */
      name: string
      /** Search query that caused the load, when the model searched. */
      query?: string
      /** Epoch milliseconds at load time. */
      at: number
    }

    /** An off-peak task entered the queue. */
    'offpeak/enqueued': {
      taskId: string
      title: string
    }

    /** The scheduler started an off-peak task in a fresh session. */
    'offpeak/started': {
      taskId: string
      sessionId: string
    }

    /** One off-peak round completed; carries counters only. */
    'offpeak/progress': {
      taskId: string
      round: number
      toolCalls: number
    }

    /** An off-peak task reached a terminal state. */
    'offpeak/finished': {
      taskId: string
      status: 'succeeded' | 'failed' | 'cancelled' | 'taken-over' | 'interrupted'
      summary?: string
    }

    /** A user came back and the off-peak task yielded. */
    'offpeak/taken-over': {
      taskId: string
      reason: string
    }

    /** One memory entry was written. */
    'memory/written': {
      id: string
      scope: 'project' | 'user'
      name: string
      bytes: number
    }

    /** One memory entry was removed (soft delete). */
    'memory/removed': {
      id: string
      scope: 'project' | 'user'
    }

    /** A durable workflow run was created. */
    'workflow/run-started': {
      runId: string
      name: string
      scriptHash: string
    }

    /** A durable workflow run reached a terminal state. */
    'workflow/run-finished': {
      runId: string
      status: 'succeeded' | 'failed' | 'cancelled' | 'budget-limited'
      summary: string
      artifactIds?: string[]
    }

    /** A durable workflow run is blocked on a hole. */
    'workflow/hole-opened': {
      runId: string
      holeId: string
      prompt: string
    }

    /** A durable workflow actor escalated a blocking question. */
    'workflow/question': {
      runId: string
      questionId: string
      question: string
    }

    /** A live durable workflow run was amended in place. */
    'workflow/run-amended': {
      runId: string
      revision: number
      changes: string[]
    }
  }
}
