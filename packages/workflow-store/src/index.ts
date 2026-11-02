/**
 * File-backed run store for durable workflows.
 *
 * One directory per run keeps the layout inspectable and the writes simple:
 * `run.json` is the mutable summary, `nodes/<id>.json` is one settled node,
 * and `events.jsonl` is the append-only journal. Writes go through a temp file
 * plus rename so a crash cannot leave a half-written JSON document.
 *
 * @module @zcd/workflow-store
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Lifecycle of one run. */
export type RunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

/** Durable run summary. */
export interface RunRecord {
  id: string
  name: string
  status: RunStatus
  script: string
  scriptHash: string
  args: unknown
  createdAt: number
  updatedAt: number
  result?: unknown
  error?: { code: string; message: string }
  nodeCount: number
}

/** One settled `agent()` invocation. */
export interface NodeRecord {
  runId: string
  nodeId: string
  index: number
  prompt: string
  status: 'succeeded' | 'failed'
  output?: string
  error?: { code: string; message: string }
  startedAt: number
  endedAt: number
}

/** Append-only journal line. */
export interface JournalEvent {
  at: number
  type: string
  data: unknown
}

/**
 * Inspectable file store.
 */
export class FileWorkflowStore {
  constructor(private readonly root: string) {}

  /** Absolute path of one run directory. */
  private runDir(runId: string): string {
    return join(this.root, 'runs', runId)
  }

  /** Atomic JSON write. */
  private writeJson(path: string, value: unknown): void {
    mkdirSync(dirname(path), { recursive: true })
    const temp = `${path}.tmp-${process.pid}-${Date.now()}`
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`)
    renameSync(temp, path)
  }

  /** Read JSON, or undefined when absent. */
  private readJson<T>(path: string): T | undefined {
    if (!existsSync(path)) return undefined
    return JSON.parse(readFileSync(path, 'utf8')) as T
  }

  /** Create a run directory and summary. */
  createRun(record: RunRecord): RunRecord {
    mkdirSync(join(this.runDir(record.id), 'nodes'), { recursive: true })
    this.writeJson(join(this.runDir(record.id), 'run.json'), record)
    this.appendEvent(record.id, { at: Date.now(), type: 'run/created', data: { name: record.name } })
    return record
  }

  /** Merge a patch into the run summary. */
  updateRun(runId: string, patch: Partial<RunRecord>): RunRecord {
    const current = this.getRun(runId)
    if (current === undefined) throw new Error(`workflow run ${runId} does not exist`)
    const next = { ...current, ...patch, updatedAt: Date.now() }
    this.writeJson(join(this.runDir(runId), 'run.json'), next)
    return next
  }

  /** Read one run summary. */
  getRun(runId: string): RunRecord | undefined {
    return this.readJson<RunRecord>(join(this.runDir(runId), 'run.json'))
  }

  /** List runs, newest first. */
  listRuns(): RunRecord[] {
    const runsDir = join(this.root, 'runs')
    if (!existsSync(runsDir)) return []
    return readdirSync(runsDir)
      .map(id => this.getRun(id))
      .filter((run): run is RunRecord => run !== undefined)
      .sort((left, right) => right.createdAt - left.createdAt)
  }

  /** Read one settled node. */
  getNode(runId: string, nodeId: string): NodeRecord | undefined {
    return this.readJson<NodeRecord>(join(this.runDir(runId), 'nodes', `${nodeId}.json`))
  }

  /** Persist one settled node. */
  putNode(node: NodeRecord): void {
    this.writeJson(join(this.runDir(node.runId), 'nodes', `${node.nodeId}.json`), node)
  }

  /** Append one journal line. */
  appendEvent(runId: string, event: JournalEvent): void {
    const path = join(this.runDir(runId), 'events.jsonl')
    mkdirSync(dirname(path), { recursive: true })
    const line = `${JSON.stringify(event)}\n`
    if (existsSync(path)) writeFileSync(path, readFileSync(path, 'utf8') + line)
    else writeFileSync(path, line)
  }

  /** Read the journal. */
  readEvents(runId: string): JournalEvent[] {
    const path = join(this.runDir(runId), 'events.jsonl')
    if (!existsSync(path)) return []
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => JSON.parse(line) as JournalEvent)
  }

  /** Stable hash of a script for node identity. */
  static hashScript(script: string): string {
    return createHash('sha256').update(script).digest('hex')
  }

  /** Stable node id from script hash, ordinal, and prompt. */
  static nodeId(scriptHash: string, index: number, prompt: string): string {
    return createHash('sha256').update(`${scriptHash}\0${index}\0${prompt}`).digest('hex').slice(0, 20)
  }
}
