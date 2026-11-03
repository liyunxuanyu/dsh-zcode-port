/**
 * `ctx.durableWorkflow` — replayable workflow runs (MVP).
 *
 * Runs execute a plain-JavaScript body. Each `agent(prompt)` is a durable node
 * keyed by `(scriptHash, ordinal|explicit key, prompt)`: a second execution of
 * the same run returns the stored output instead of calling the model again.
 * `parallel()`, `pipeline()`, `hole()`, replay, resume, cancel, amend, and the
 * journal events land on top of this seam; `docs/04-durable-workflow.md` is the
 * specification.
 *
 * @module @zcd/durable-workflow
 */

import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@zcd/shared/events'
import { FileWorkflowStore, type HoleRecord, type JournalEvent, type NodeRecord, type RunRecord } from '@zcd/workflow-store'
import type { WorkflowRunView, WorkflowStartRequest } from './types.js'

export type * from './types.js'

/** Deployment configuration. */
export interface Config {
  /** Store root; defaults to `$DSH_HOME/storages/zcd-workflow`. */
  root?: string
  /** Hard cap on `agent()` calls in one run. */
  maxNodes?: number
  /** Per-node deadline in milliseconds. */
  nodeTimeoutMs?: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    durableWorkflow: DurableWorkflowService
  }
}

/** Internal control flow: the script stopped at a hole. */
class HolePause extends Error {
  constructor(readonly hole: HoleRecord) {
    super('workflow paused at a hole')
    this.name = 'HolePause'
  }
}

/** Flatten model content into text. */
function flatten(content: readonly unknown[]): string {
  const parts: string[] = []
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const candidate = block as { type?: string; text?: string }
    if (candidate.type === 'text' && typeof candidate.text === 'string') parts.push(candidate.text)
  }
  return parts.join('\n').trim()
}

/**
 * Durable workflow service.
 */
export class DurableWorkflowService extends Service {
  static inject = ['agents']

  private readonly store: FileWorkflowStore
  private readonly aborters = new Map<string, AbortController>()
  private readonly maxNodes: number
  private readonly nodeTimeoutMs: number

  constructor(ctx: Context, private readonly config: Config = {}) {
    super(ctx, 'durableWorkflow')
    const root = config.root ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'storages', 'zcd-workflow')
    this.store = new FileWorkflowStore(root)
    this.maxNodes = config.maxNodes ?? 100
    this.nodeTimeoutMs = config.nodeTimeoutMs ?? 30 * 60_000
  }

  /**
   * Create and start a run without waiting for it.
   * @param request - script, label, and args.
   * @param parent - agent that owns the run.
   * @returns the run view at creation time.
   */
  start(request: WorkflowStartRequest, parent: Agent): WorkflowRunView {
    const script = request.script.trim()
    if (script.length === 0) throw new Error('workflow script must not be empty')
    const id = `run-${randomUUID()}`
    const scriptHash = FileWorkflowStore.hashScript(script)
    const record: RunRecord = {
      id,
      name: request.name?.trim() || 'workflow',
      status: 'queued',
      script,
      scriptHash,
      args: request.args ?? {},
      parentSessionId: String(parent.session.id),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      nodeCount: 0,
    }
    this.store.createRun(record)
    const aborter = new AbortController()
    this.aborters.set(id, aborter)
    void this.execute(record, parent, aborter.signal).finally(() => { this.aborters.delete(id) })
    return this.view(record)
  }

  /**
   * Resume an interrupted or failed run. Completed nodes are replayed from the
   * store and never call the model again.
   * @param runId - run id.
   * @param parent - agent that owns the resumed run.
   * @returns the run view at resume time.
   */
  resume(runId: string, parent: Agent): WorkflowRunView {
    const record = this.requireRun(runId)
    if (record.status === 'running') throw new Error(`workflow ${runId} is already running`)
    const next = this.store.updateRun(runId, { status: 'queued', error: undefined, finishedAt: undefined })
    const aborter = new AbortController()
    this.aborters.set(runId, aborter)
    void this.execute(next, parent, aborter.signal).finally(() => { this.aborters.delete(runId) })
    return this.view(next)
  }

  /**
   * Resume a run from its recorded parent session, when that session is live.
   *
   * The CLI tools already pass the caller agent directly. This method is for
   * host surfaces (the run panel) that only know the run id; after a restart the
   * parent is gone, and the caller must resume from that session instead.
   *
   * @param runId - run id.
   * @returns the run view at resume time.
   */
  resumeFromStore(runId: string): WorkflowRunView {
    const record = this.requireRun(runId)
    if (record.parentSessionId === undefined) {
      throw new Error(`workflow ${runId} has no recorded parent session`)
    }
    const parent = this.ctx.agents.get(record.parentSessionId as SessionId)
    if (parent === undefined) {
      throw new Error(`workflow ${runId} parent session is not live; resume it from that session`)
    }
    return this.resume(runId, parent)
  }

  /**
   * Amend a run from its recorded parent session, when that session is live.
   * A new script creates a successor run; a name-only change renames in place.
   *
   * @param runId - run id.
   * @param patch - replacement script and/or display name.
   * @returns the amended or successor view.
   */
  amendFromStore(runId: string, patch: { script?: string; name?: string }): WorkflowRunView {
    const record = this.requireRun(runId)
    if (record.parentSessionId === undefined) {
      throw new Error(`workflow ${runId} has no recorded parent session`)
    }
    const parent = this.ctx.agents.get(record.parentSessionId as SessionId)
    if (parent === undefined) {
      throw new Error(`workflow ${runId} parent session is not live; amend it from that session`)
    }
    return this.amend(runId, patch, parent)
  }

  /**
   * Cancel a queued or running run.
   * @param runId - run id.
   * @param reason - recorded in the error field.
   */
  cancel(runId: string, reason = 'cancelled by request'): void {
    const record = this.requireRun(runId)
    this.aborters.get(runId)?.abort(new Error(reason))
    if (record.status === 'queued' || record.status === 'running') {
      this.store.updateRun(runId, {
        status: 'cancelled',
        error: { code: 'WORKFLOW_CANCELLED', message: reason },
        finishedAt: Date.now(),
      })
      this.store.appendEvent(runId, { at: Date.now(), type: 'run/cancelled', data: { reason } })
    }
  }

  /**
   * Wait until a run reaches a terminal state.
   * @param runId - run id.
   * @param timeoutMs - maximum wait; rejects on timeout.
   * @returns the terminal view.
   */
  async wait(runId: string, timeoutMs = 10 * 60_000): Promise<WorkflowRunView> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const record = this.requireRun(runId)
      if (record.status === 'succeeded' || record.status === 'failed'
        || record.status === 'cancelled' || record.status === 'waiting-hole') return this.view(record)
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    throw new Error(`workflow ${runId} did not finish within ${timeoutMs}ms`)
  }

  /**
   * Amend a run. A new script creates a successor run and cancels the old one;
   * a name-only change updates the existing summary.
   * @param runId - run id.
   * @param patch - replacement script and/or display name.
   * @param parent - agent that owns the run.
   * @returns the amended or successor view.
   */
  amend(runId: string, patch: { script?: string; name?: string }, parent: Agent): WorkflowRunView {
    const record = this.requireRun(runId)
    if (patch.script === undefined) {
      if (patch.name === undefined) throw new Error('workflow_amend requires a script or a name')
      return this.view(this.store.updateRun(runId, { name: patch.name.trim() || record.name }))
    }
    if (record.status === 'running' || record.status === 'queued') {
      this.cancel(runId, 'superseded by an amended script')
    }
    return this.start({
      script: patch.script,
      name: patch.name?.trim() || `${record.name} (amended)`,
      args: record.args,
    }, parent)
  }

  /**
   * Answer an open hole and continue the run. The script replays from the top;
   * completed agent nodes and earlier answered holes are reused.
   * @param runId - run id.
   * @param holeId - hole id from the run view.
   * @param answer - code or text the script receives from `hole()`.
   * @param parent - agent that owns the run.
   * @returns the run view after resuming.
   */
  answerHole(runId: string, holeId: string, answer: string, parent: Agent): WorkflowRunView {
    const record = this.requireRun(runId)
    if (record.status !== 'waiting-hole') {
      throw new Error(`workflow ${runId} is not waiting for a hole (status ${record.status})`)
    }
    const hole = this.store.getHole(runId, holeId)
    if (hole === undefined) throw new Error(`hole ${holeId} does not exist in ${runId}`)
    if (hole.answer !== undefined) throw new Error(`hole ${holeId} is already answered`)
    this.store.putHole({ ...hole, answer, answeredAt: Date.now() })
    this.store.appendEvent(runId, { at: Date.now(), type: 'run/hole-filled', data: { holeId } })
    const next = this.store.updateRun(runId, { status: 'queued', error: undefined, finishedAt: undefined })
    const aborter = new AbortController()
    this.aborters.set(runId, aborter)
    void this.execute(next, parent, aborter.signal).finally(() => { this.aborters.delete(runId) })
    return this.view(next)
  }

  /**
   * List the settled nodes of one run.
   * @param runId - run id.
   * @returns nodes ordered by call ordinal.
   */
  nodes(runId: string): NodeRecord[] {
    this.requireRun(runId)
    return this.store.listNodes(runId)
  }

  /**
   * Forget one settled node so the next execution runs it again instead of
   * replaying the stored output. The caller resumes the run afterwards; a node
   * that is still part of the current session's memory cannot be replayed past,
   * so retry is always "drop node, then resume".
   *
   * @param runId - run id.
   * @param nodeId - settled node id from {@link nodes}.
   * @returns the drop result and the refreshed run view.
   */
  retryNode(runId: string, nodeId: string): { dropped: boolean; nodeId: string; view: WorkflowRunView } {
    const record = this.requireRun(runId)
    if (record.status === 'running') {
      throw new Error(`workflow ${runId} is running; cancel it before retrying a node`)
    }
    const dropped = this.store.deleteNode(runId, nodeId)
    if (dropped) {
      this.store.appendEvent(runId, { at: Date.now(), type: 'node/dropped', data: { nodeId } })
      this.store.updateRun(runId, { nodeCount: this.store.countNodes(runId) })
    }
    return { dropped, nodeId, view: this.view(this.requireRun(runId)) }
  }

  /**
   * Read the journal of one run, oldest first.
   * @param runId - run id.
   * @returns journal events (`node/*`, `run/*`, `hole/*`).
   */
  events(runId: string): JournalEvent[] {
    this.requireRun(runId)
    return this.store.readEvents(runId)
  }

  /**
   * Read one run.
   * @param runId - run id.
   * @returns a detached view.
   */
  get(runId: string): WorkflowRunView {
    return this.view(this.requireRun(runId))
  }

  /**
   * List runs, newest first.
   * @param limit - maximum rows.
   * @returns detached views.
   */
  list(limit = 20): WorkflowRunView[] {
    return this.store.listRuns().slice(0, Math.max(1, limit)).map(record => this.view(record))
  }

  /** Load a run or throw a typed message. */
  private requireRun(runId: string): RunRecord {
    const record = this.store.getRun(runId)
    if (record === undefined) throw new Error(`workflow run ${runId} does not exist`)
    return record
  }

  /**
   * Tell the parent agent that a run needs attention. Uses `inject` so the
   * notice is durable context for the next step instead of waking a turn.
   * @param parent - owning agent.
   * @param record - run summary at settlement.
   */
  private notify(parent: Agent, record: RunRecord): void {
    const lines = [`Workflow ${record.id} (${record.name}) is ${record.status}.`]
    if (record.status === 'waiting-hole') {
      const hole = this.store.listHoles(record.id).find(item => item.answer === undefined)
      if (hole !== undefined) {
        lines.push(`Hole ${hole.holeId}: ${hole.prompt}`)
        lines.push('Call workflow_answer_hole with run_id, hole_id, and answer to continue.')
      }
    } else if (record.status === 'failed' && record.error !== undefined) {
      lines.push(`${record.error.code}: ${record.error.message}`)
    } else if (record.status === 'succeeded') {
      lines.push(`Nodes: ${record.nodeCount}`)
    }
    try {
      parent.inject(createUserMessage({
        content: [{ type: 'text', text: lines.join('\n') }],
        source: { kind: 'zcd-workflow' },
      }))
    } catch (error: unknown) {
      this.ctx.logger.warn('zcd-workflow: failed to notify parent %s: %o', record.id, error)
    }
  }

  /** Project the store record onto the public view. */
  private view(record: RunRecord): WorkflowRunView {
    return {
      id: record.id,
      name: record.name,
      status: record.status,
      script: record.script,
      args: record.args,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      nodeCount: record.nodeCount,
      durationMs: (record.finishedAt ?? record.updatedAt) - (record.startedAt ?? record.createdAt),
      ...(record.result === undefined ? {} : { result: record.result }),
      ...(record.error === undefined ? {} : { error: record.error }),
      ...(this.store.listHoles(record.id).length === 0 ? {} : {
        holes: this.store.listHoles(record.id).map(hole => ({
          id: hole.holeId,
          prompt: hole.prompt,
          ...(hole.answer === undefined ? {} : { answer: hole.answer }),
        })),
      }),
    }
  }

  /**
   * Execute (or replay) one run.
   * @param record - run summary.
   * @param parent - owning agent.
   * @param signal - cancellation.
   */
  private async execute(record: RunRecord, parent: Agent, signal: AbortSignal): Promise<void> {
    this.store.updateRun(record.id, {
      status: 'running',
      ...(record.startedAt === undefined ? { startedAt: Date.now() } : {}),
    })
    let index = 0
    let holeIndex = 0
    const executeAgent = async (prompt: string, options?: { key?: string }): Promise<string> => {
      if (signal.aborted) throw new Error('workflow cancelled')
      if (index >= this.maxNodes) throw new Error(`workflow exceeded ${this.maxNodes} agent calls`)
      const key = options?.key
      const ordinal = key === undefined ? index++ : -1
      return this.runAgent(record, ordinal, String(prompt), parent, signal, key)
    }
    const sandbox = {
      agent: executeAgent,
      parallel: async (items: unknown[], fn: (item: unknown, index: number) => Promise<unknown>, options?: { concurrency?: number }) => {
        const list = [...items]
        const limit = Math.max(1, Math.min(16, options?.concurrency ?? 4))
        const results = new Array<unknown>(list.length)
        let cursor = 0
        const worker = async (): Promise<void> => {
          while (true) {
            const at = cursor++
            if (at >= list.length) return
            results[at] = await fn(list[at], at)
          }
        }
        await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker))
        return results
      },
      pipeline: async (items: unknown[], ...stages: Array<(value: unknown, index: number) => Promise<unknown>>) => {
        const list = [...items]
        const results = new Array<unknown>(list.length)
        for (let i = 0; i < list.length; i++) {
          let value: unknown = list[i]
          for (const stage of stages) value = await stage(value, i)
          results[i] = value
        }
        return results
      },
      hole: (prompt: unknown): string => {
        const text = String(prompt)
        const holeId = FileWorkflowStore.nodeId(record.scriptHash, `hole:${holeIndex++}`, text)
        const existing = this.store.getHole(record.id, holeId)
        if (existing?.answer !== undefined) return existing.answer
        const hole: HoleRecord = { runId: record.id, holeId, prompt: text, createdAt: Date.now() }
        this.store.putHole(hole)
        this.store.appendEvent(record.id, { at: Date.now(), type: 'run/hole-opened', data: { holeId, prompt: text } })
        throw new HolePause(hole)
      },
      phase: (name: unknown) => {
        this.store.appendEvent(record.id, { at: Date.now(), type: 'run/phase', data: { name: String(name) } })
      },
      report: (value: unknown) => {
        this.store.appendEvent(record.id, { at: Date.now(), type: 'run/report', data: { value } })
      },
      log: (message: unknown) => {
        this.store.appendEvent(record.id, { at: Date.now(), type: 'run/log', data: { message: String(message) } })
      },
      args: structuredClone(record.args),
      console: { log: (message: unknown) => { this.store.appendEvent(record.id, { at: Date.now(), type: 'run/log', data: { message: String(message) } }) } },
    }
    try {
      const script = new vm.Script(`(async () => {\n${record.script}\n})()`, { filename: `${record.id}.workflow.js` })
      const context = vm.createContext(sandbox, { name: record.id })
      const pending = script.runInContext(context, { timeout: 5_000 }) as Promise<unknown>
      const value = await pending
      if (signal.aborted) throw new Error('workflow cancelled')
      const result = value === undefined ? null : JSON.parse(JSON.stringify(value)) as unknown
      const finished = this.store.updateRun(record.id, { status: 'succeeded', result, error: undefined, finishedAt: Date.now() })
      this.store.appendEvent(record.id, { at: Date.now(), type: 'run/finished', data: { status: 'succeeded' } })
      this.notify(parent, finished)
    } catch (error: unknown) {
      if (error instanceof HolePause) {
        const paused = this.store.updateRun(record.id, { status: 'waiting-hole', error: undefined })
        this.notify(parent, paused)
        return
      }
      if (signal.aborted) {
        const cancelled = this.store.updateRun(record.id, {
          status: 'cancelled',
          error: { code: 'WORKFLOW_CANCELLED', message: 'cancelled' },
          finishedAt: Date.now(),
        })
        this.notify(parent, cancelled)
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      const failed = this.store.updateRun(record.id, {
        status: 'failed',
        error: { code: 'WORKFLOW_FAILED', message },
        finishedAt: Date.now(),
      })
      this.store.appendEvent(record.id, { at: Date.now(), type: 'run/finished', data: { status: 'failed', message } })
      this.notify(parent, failed)
    }
  }

  /**
   * Run one durable node, replaying a settled output when present.
   * @param record - owning run.
   * @param index - call ordinal within the script.
   * @param prompt - model instruction.
   * @param parent - owning agent (cwd source).
   * @param signal - cancellation.
   * @returns the child's final assistant text.
   */
  private async runAgent(record: RunRecord, index: number, prompt: string, parent: Agent, signal: AbortSignal, key?: string): Promise<string> {
    const nodeId = FileWorkflowStore.nodeId(record.scriptHash, key ?? index, prompt)
    const existing = this.store.getNode(record.id, nodeId)
    if (existing?.status === 'succeeded') {
      this.store.appendEvent(record.id, { at: Date.now(), type: 'node/replayed', data: { nodeId, index } })
      return existing.output ?? ''
    }
    const startedAt = Date.now()
    this.store.appendEvent(record.id, { at: startedAt, type: 'node/started', data: { nodeId, index } })
    const cwd = parent.session.header.cwd
    const selection = this.ctx.get('agentDefaultModel')?.currentSelection()
    const model = selection === undefined ? undefined : `${selection.provider}/${selection.model}`
    const child = await this.ctx.agents.create({
      sessionId: `session-${randomUUID()}` as SessionId,
      parentAgent: parent,
      ...(cwd === undefined ? {} : { meta: { cwd, parentSession: parent.session.id, origin: 'subagent' as const } }),
      ...(selection === undefined ? {} : { agentOptions: selection }),
    })
    const agent = child.agent
    let last = ''
    const off = this.ctx.on('session/event', (session, event) => {
      if (session !== agent.session) return
      if (event.type !== 'assistant/message') return
      const text = flatten(event.data.message.content)
      if (text.length > 0) last = text
    })
    const timer = setTimeout(() => {
      agent.cancel({ kind: 'user' })
    }, this.nodeTimeoutMs)
    try {
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: prompt }],
        source: { kind: 'user' },
      }))
      await agent.whenIdle()
      if (signal.aborted) throw new Error('workflow cancelled')
      const node: NodeRecord = {
        runId: record.id,
        nodeId,
        index,
        ...(key === undefined ? {} : { key }),
        prompt,
        status: 'succeeded',
        output: last,
        ...(model === undefined ? {} : { model }),
        startedAt,
        endedAt: Date.now(),
      }
      this.store.putNode(node)
      this.store.updateRun(record.id, { nodeCount: this.store.countNodes(record.id) })
      this.store.appendEvent(record.id, {
        at: node.endedAt,
        type: 'node/finished',
        data: { nodeId, index, durationMs: node.endedAt - startedAt, ...(model === undefined ? {} : { model }) },
      })
      return last
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.store.putNode({
        runId: record.id,
        nodeId,
        index,
        ...(key === undefined ? {} : { key }),
        prompt,
        status: 'failed',
        error: { code: 'NODE_FAILED', message },
        ...(model === undefined ? {} : { model }),
        startedAt,
        endedAt: Date.now(),
      })
      throw error
    } finally {
      clearTimeout(timer)
      off()
      await child.dispose()
    }
  }
}

export default DurableWorkflowService
