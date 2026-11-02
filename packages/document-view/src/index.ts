/**
 * `ctx.documentView` — the last document location each session asked to see.
 *
 * The browser owns the actual tab; this service stores only the request so a
 * model can answer "what am I looking at" without guessing. Process-local and
 * bounded; a restart clears it.
 *
 * @module @zcd/document-view
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'

/** One recorded view request. */
export interface DocumentView {
  readonly path: string
  readonly anchor?: string
  readonly at: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    documentView: DocumentViewService
  }
}

/**
 * Bounded per-session view registry.
 */
export class DocumentViewService extends Service {
  private readonly views = new Map<string, DocumentView>()
  private readonly maxSessions: number

  constructor(ctx: Context) {
    super(ctx, 'documentView')
    this.maxSessions = 200
  }

  /**
   * Record the latest view request for one session.
   * @param sessionId - owning session id.
   * @param view - path and optional anchor.
   */
  record(sessionId: string, view: { path: string; anchor?: string }): void {
    if (this.views.size >= this.maxSessions && !this.views.has(sessionId)) {
      const oldest = [...this.views.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      if (oldest !== undefined) this.views.delete(oldest[0])
    }
    this.views.set(sessionId, {
      path: view.path,
      ...(view.anchor === undefined ? {} : { anchor: view.anchor }),
      at: Date.now(),
    })
  }

  /**
   * Read the latest view for one session.
   * @param sessionId - owning session id.
   * @returns the view, or undefined.
   */
  get(sessionId: string): DocumentView | undefined {
    return this.views.get(sessionId)
  }
}

export default DocumentViewService
