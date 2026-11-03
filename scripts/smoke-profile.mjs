#!/usr/bin/env node
/**
 * End-to-end smoke for the product profile.
 *
 * Boots `dsh --profile product` on an OS-assigned port, waits for the printed
 * Web URL, fetches it with the printed token, and fails if any plugin did not
 * activate. This is the P0 acceptance check: the overlay must compose with
 * dsh's own bundles and load every ZCD plugin.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const bin = join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
const home = process.env.ZCD_DSH_HOME ?? join(root, '.dsh-home')
const profile = join(home, 'profiles/product')
const genuiDir = join(home, 'storages', 'zcd-genui', '__smoke__')
const memoryHome = join(home, 'memory-smoke')
const workflowRuns = join(home, 'storages', 'zcd-workflow', 'runs')
const fixtureId = 'run-smoke'
const fixtureNodeId = 'smoke-node-1'
const runningId = 'run-smoke-running'

if (!existsSync(bin)) {
  console.error('✖ dsh is not installed; run `pnpm install` first.')
  process.exit(1)
}
if (!existsSync(profile)) {
  console.error(`✖ profile missing at ${profile}; run scripts/link-profile.mjs first.`)
  process.exit(1)
}

mkdirSync(genuiDir, { recursive: true })
rmSync(memoryHome, { recursive: true, force: true })
rmSync(join(workflowRuns, fixtureId), { recursive: true, force: true })
rmSync(join(workflowRuns, runningId), { recursive: true, force: true })
const now = Date.now()
mkdirSync(join(workflowRuns, fixtureId, 'nodes'), { recursive: true })
writeFileSync(join(workflowRuns, fixtureId, 'run.json'), JSON.stringify({
  id: fixtureId,
  name: 'smoke fixture',
  status: 'succeeded',
  script: 'return await agent("Summarize the changelog")',
  scriptHash: 'smoke',
  args: {},
  createdAt: now,
  updatedAt: now,
  result: 'Smoke fixture finished.',
  nodeCount: 1,
}, null, 2))
writeFileSync(join(workflowRuns, fixtureId, 'nodes', `${fixtureNodeId}.json`), JSON.stringify({
  runId: fixtureId,
  nodeId: fixtureNodeId,
  index: 0,
  prompt: 'Summarize the changelog',
  status: 'succeeded',
  output: 'Smoke fixture output.',
  model: 'smoke/model',
  startedAt: now,
  endedAt: now + 10,
}, null, 2))
mkdirSync(join(workflowRuns, runningId, 'nodes'), { recursive: true })
writeFileSync(join(workflowRuns, runningId, 'run.json'), JSON.stringify({
  id: runningId,
  name: 'smoke running fixture',
  status: 'running',
  script: 'return await agent("still running")',
  scriptHash: 'smoke-running',
  args: {},
  createdAt: now + 1,
  updatedAt: now + 1,
  nodeCount: 0,
}, null, 2))
writeFileSync(join(workflowRuns, runningId, 'events.jsonl'),
  `${JSON.stringify({ at: now + 1, type: 'run/created', data: { name: 'smoke running fixture' } })}\n`)
writeFileSync(join(workflowRuns, fixtureId, 'events.jsonl'), [
  { at: now, type: 'run/created', data: { name: 'smoke fixture' } },
  { at: now + 1, type: 'node/started', data: { nodeId: fixtureNodeId, index: 0 } },
  { at: now + 10, type: 'node/finished', data: { nodeId: fixtureNodeId, index: 0 } },
  { at: now + 11, type: 'run/finished', data: { status: 'succeeded' } },
].map(event => JSON.stringify(event)).join('\n') + '\n')
writeFileSync(join(genuiDir, 'probe.html'), '<!doctype html><h1>zcd genui smoke</h1>')

const child = spawn(process.execPath, [bin, '--profile', 'product', '--no-open', '--port', '0'], {
  cwd: root,
  env: { ...process.env, DSH_HOME: home, ZCD_USER_MEMORY_HOME: memoryHome },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let stdout = ''
let stderr = ''
child.stdout.on('data', chunk => { stdout += chunk })
child.stderr.on('data', chunk => { stderr += chunk })

/** Resolve the first printed Web URL. */
function waitForUrl(timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const timer = setInterval(() => {
      const match = stdout.match(/http:\/\/127\.0\.0\.1:(\d+)\/\?token=([A-Za-z0-9_-]+)/)
      if (match !== null) {
        clearInterval(timer)
        resolve({ port: Number(match[1]), token: match[2] })
      } else if (Date.now() > deadline) {
        clearInterval(timer)
        reject(new Error(`no Web URL after ${timeoutMs}ms\nstdout:\n${stdout}\nstderr:\n${stderr}`))
      } else if (child.exitCode !== null) {
        clearInterval(timer)
        reject(new Error(`dsh exited early (${child.exitCode})\nstderr:\n${stderr}`))
      }
    }, 250)
  })
}

try {
  const { port, token } = await waitForUrl(60_000)
  const response = await fetch(`http://127.0.0.1:${port}/?token=${token}`, { redirect: 'manual' })
  // The token flow may redirect into a cookie-authenticated page; a 401 is the
  // unauthenticated answer and 3xx is the hand-off. Any 5xx means the runtime
  // itself is unhealthy.
  if (response.status >= 500) {
    throw new Error(`Web UI returned ${response.status}`)
  }
  if (stderr.includes('did not activate')) {
    throw new Error(`a plugin failed to activate:\n${stderr}`)
  }

  const genui = await fetch(`http://127.0.0.1:${port}/zcd/genui/__smoke__/probe`)
  const csp = genui.headers.get('content-security-policy') ?? ''
  if (genui.status !== 200 || !csp.includes('sandbox allow-scripts')) {
    throw new Error(`genui route failed: ${genui.status} csp=${csp}`)
  }

  const recorded = await fetch(`http://127.0.0.1:${port}/zcd/documents/view`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'smoke', path: '/work/notes.md', anchor: '#l:3' }),
  })
  if (recorded.status !== 204) throw new Error(`document view POST failed: ${recorded.status}`)
  const view = await fetch(`http://127.0.0.1:${port}/zcd/documents/view?sessionId=smoke`)
  const viewBody = await view.json().catch(() => undefined)
  if (view.status !== 200 || viewBody?.path !== '/work/notes.md' || viewBody?.anchor !== '#l:3') {
    throw new Error(`document view GET failed: ${view.status}`)
  }

  const status = await fetch(`http://127.0.0.1:${port}/zcd/status`)
  const statusBody = await status.json().catch(() => undefined)
  if (status.status !== 200 || statusBody?.product !== 'ZCD') {
    throw new Error(`status route failed: ${status.status}`)
  }

  const runList = await fetch(`http://127.0.0.1:${port}/zcd/workflow/runs`)
  const runListBody = await runList.json().catch(() => undefined)
  if (runList.status !== 200 || !Array.isArray(runListBody?.runs)) {
    throw new Error(`workflow list route failed: ${runList.status}`)
  }
  const fixture = runListBody.runs.find(run => run.id === fixtureId)
  if (fixture?.status !== 'succeeded' || fixture?.nodeCount !== 1) {
    throw new Error(`workflow list did not expose the fixture: ${JSON.stringify(runListBody)}`)
  }
  if (typeof fixture.durationMs !== 'number') {
    throw new Error(`workflow list did not expose a duration: ${JSON.stringify(fixture)}`)
  }
  const fixtureNodes = await fetch(`http://127.0.0.1:${port}/zcd/workflow/runs/${fixtureId}/nodes`)
  const fixtureNodesBody = await fixtureNodes.json().catch(() => undefined)
  if (fixtureNodes.status !== 200 || fixtureNodesBody?.nodes?.[0]?.prompt !== 'Summarize the changelog') {
    throw new Error(`workflow nodes route failed: ${fixtureNodes.status}`)
  }
  // The run panel renders model and duration columns from these two fields.
  if (fixtureNodesBody.nodes[0].model !== 'smoke/model' || fixtureNodesBody.nodes[0].durationMs !== 10) {
    throw new Error(`workflow nodes did not expose model/duration: ${JSON.stringify(fixtureNodesBody.nodes[0])}`)
  }
  const fixtureEvents = await fetch(`http://127.0.0.1:${port}/zcd/workflow/runs/${fixtureId}/events`)
  const fixtureEventsBody = await fixtureEvents.json().catch(() => undefined)
  const eventTypes = Array.isArray(fixtureEventsBody?.events) ? fixtureEventsBody.events.map(event => event.type) : []
  for (const type of ['run/created', 'node/started', 'node/finished', 'run/finished']) {
    if (!eventTypes.includes(type)) throw new Error(`workflow events missing ${type}: ${JSON.stringify(fixtureEventsBody)}`)
  }
  // Node retry while the run is still executing must be refused: the engine
  // cannot drop a node the live script may still replay.
  const retryRunning = await fetch(`http://127.0.0.1:${port}/zcd/workflow/runs/${runningId}/nodes/${fixtureNodeId}/retry`, { method: 'POST' })
  if (retryRunning.status !== 409) throw new Error(`workflow retry of a running run should be 409: ${retryRunning.status}`)
  const cancelled = await fetch(`http://127.0.0.1:${port}/zcd/workflow/runs/${runningId}/cancel`, { method: 'POST' })
  if (cancelled.status !== 200) throw new Error(`workflow cancel of a running run failed: ${cancelled.status}`)
  const cancelledBody = await (await fetch(`http://127.0.0.1:${port}/zcd/workflow/runs/${runningId}`)).json().catch(() => undefined)
  if (cancelledBody?.status !== 'cancelled') {
    throw new Error(`workflow cancel did not settle the run: ${JSON.stringify(cancelledBody)}`)
  }
  const cancelledEvents = await (await fetch(`http://127.0.0.1:${port}/zcd/workflow/runs/${runningId}/events`)).json().catch(() => undefined)
  if (!Array.isArray(cancelledEvents?.events) || !cancelledEvents.events.some(event => event.type === 'run/cancelled')) {
    throw new Error(`workflow cancel did not append run/cancelled: ${JSON.stringify(cancelledEvents)}`)
  }
  // Fixtures have no live parent session, so the panel's resume path must
  // refuse with a readable 409 instead of starting a detached run.
  const resume = await fetch(`http://127.0.0.1:${port}/zcd/workflow/runs/${runningId}/resume`, { method: 'POST' })
  if (resume.status !== 409) throw new Error(`workflow resume without a live parent should be 409: ${resume.status}`)
  const detail = await (await fetch(`http://127.0.0.1:${port}/zcd/workflow/runs/${fixtureId}`)).json().catch(() => undefined)
  if (detail?.script !== 'return await agent("Summarize the changelog")') {
    throw new Error(`workflow detail did not expose the script: ${JSON.stringify(detail)}`)
  }
  const amend = await fetch(`http://127.0.0.1:${port}/zcd/workflow/runs/${fixtureId}/amend`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ script: 'return "amended"' }),
  })
  if (amend.status !== 409) throw new Error(`workflow amend without a live parent should be 409: ${amend.status}`)

  // Node retry: drop the settled node from a finished run and journal it; a
  // missing node reports 404 instead of pretending the retry happened.
  const retry = await fetch(`http://127.0.0.1:${port}/zcd/workflow/runs/${fixtureId}/nodes/${fixtureNodeId}/retry`, { method: 'POST' })
  const retryBody = await retry.json().catch(() => undefined)
  if (retry.status !== 200 || retryBody?.dropped !== true || retryBody?.run?.nodeCount !== 0) {
    throw new Error(`workflow retry did not drop the node: ${retry.status} ${JSON.stringify(retryBody)}`)
  }
  const retriedNodes = await (await fetch(`http://127.0.0.1:${port}/zcd/workflow/runs/${fixtureId}/nodes`)).json().catch(() => undefined)
  if (!Array.isArray(retriedNodes?.nodes) || retriedNodes.nodes.length !== 0) {
    throw new Error(`workflow retry left the node in place: ${JSON.stringify(retriedNodes)}`)
  }
  const retriedEvents = await (await fetch(`http://127.0.0.1:${port}/zcd/workflow/runs/${fixtureId}/events`)).json().catch(() => undefined)
  if (!retriedEvents?.events?.some(event => event.type === 'node/dropped')) {
    throw new Error(`workflow retry did not journal node/dropped: ${JSON.stringify(retriedEvents)}`)
  }
  const retryMissing = await fetch(`http://127.0.0.1:${port}/zcd/workflow/runs/${fixtureId}/nodes/not-a-node/retry`, { method: 'POST' })
  if (retryMissing.status !== 404) throw new Error(`workflow retry of a missing node should be 404: ${retryMissing.status}`)

  const workflow = await fetch(`http://127.0.0.1:${port}/zcd/workflow/runs/not-a-run`)
  const workflowBody = await workflow.text()
  if (workflow.status !== 404 || !workflowBody.includes('not-found')) {
    throw new Error(`workflow route failed: ${workflow.status} ${workflowBody}`)
  }
  const cancel = await fetch(`http://127.0.0.1:${port}/zcd/workflow/runs/not-a-run/cancel`, { method: 'POST' })
  if (cancel.status !== 404) throw new Error(`workflow cancel route failed: ${cancel.status}`)
  const nodes = await fetch(`http://127.0.0.1:${port}/zcd/workflow/runs/not-a-run/nodes`)
  if (nodes.status !== 404) throw new Error(`workflow nodes route failed: ${nodes.status}`)
  const events = await fetch(`http://127.0.0.1:${port}/zcd/workflow/runs/not-a-run/events`)
  if (events.status !== 404) throw new Error(`workflow events route failed: ${events.status}`)

  // User memory: list → create → list → delete → list. The smoke home is a
  // throwaway directory, so "empty" is a meaningful assertion.
  const memoryList = await fetch(`http://127.0.0.1:${port}/zcd/memory`)
  const memoryListBody = await memoryList.json().catch(() => undefined)
  if (memoryList.status !== 200 || !Array.isArray(memoryListBody?.entries) || memoryListBody.entries.length !== 0) {
    throw new Error(`memory list route failed: ${memoryList.status}`)
  }
  const created = await fetch(`http://127.0.0.1:${port}/zcd/memory`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Smoke memory probe',
      description: 'Written by the product-profile smoke test.',
      type: 'fact',
      body: 'User memory can be written from the settings surface.',
    }),
  })
  const createdBody = await created.json().catch(() => undefined)
  if (created.status !== 201 || typeof createdBody?.entry?.id !== 'string') {
    throw new Error(`memory create route failed: ${created.status} ${JSON.stringify(createdBody)}`)
  }
  const afterCreate = await fetch(`http://127.0.0.1:${port}/zcd/memory`)
  const afterCreateBody = await afterCreate.json().catch(() => undefined)
  if (!Array.isArray(afterCreateBody?.entries) || !afterCreateBody.entries.some(entry => entry.id === createdBody.entry.id)) {
    throw new Error(`memory create was not persisted: ${afterCreate.status}`)
  }
  const dreamed = await fetch(`http://127.0.0.1:${port}/zcd/memory/dream`, { method: 'POST' })
  const dreamedBody = await dreamed.json().catch(() => undefined)
  if (dreamed.status !== 200 || dreamedBody?.report?.scanned < 1 || dreamedBody?.report?.kept < 1) {
    throw new Error(`memory dream failed: ${dreamed.status} ${JSON.stringify(dreamedBody)}`)
  }
  const removed = await fetch(`http://127.0.0.1:${port}/zcd/memory/${createdBody.entry.id}`, { method: 'DELETE' })
  if (removed.status !== 200) throw new Error(`memory delete route failed: ${removed.status}`)
  const afterDelete = await fetch(`http://127.0.0.1:${port}/zcd/memory`)
  const afterDeleteBody = await afterDelete.json().catch(() => undefined)
  if (!Array.isArray(afterDeleteBody?.entries) || afterDeleteBody.entries.length !== 0) {
    throw new Error(`memory delete did not remove the entry: ${afterDelete.status}`)
  }

  // Client cards must be in the browser boot graph and their bundles served.
  const login = await fetch(`http://127.0.0.1:${port}/?token=${token}`, { redirect: 'manual' })
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  const page = await fetch(`http://127.0.0.1:${port}/`, { headers: cookie === '' ? {} : { cookie } })
  const html = await page.text()
  for (const [id, marker] of [
    ['@zcd/client-ui-genui', 'tool.call.toolview'],
    ['@zcd/client-ui-zcd', 'read_document'],
    ['@zcd/client-ui-settings-zcd', 'settings.section'],
    ['@zcd/client-ui-workflow', 'sidebar.right.pane.tab'],
  ]) {
    const prefix = `${id}/client.js&rev=`
    const at = html.indexOf(prefix)
    const rev = at < 0 ? undefined : html.slice(at + prefix.length, at + prefix.length + 12)
    if (rev === undefined || !/^[a-f0-9]{12}$/.test(rev)) {
      throw new Error(`${id} is missing from the browser boot graph`)
    }
    const bundle = await fetch(`http://127.0.0.1:${port}/plugins/??${id}/client.js&rev=${rev}`)
    const source = await bundle.text()
    if (bundle.status !== 200 || !source.includes(marker)) {
      throw new Error(`${id} bundle failed: ${bundle.status}`)
    }
  }
  console.log(`✓ product profile boots on :${port}; HTTP ${response.status}; all plugins and client cards active`)
} finally {
  child.kill('SIGTERM')
  await new Promise(resolve => setTimeout(resolve, 500))
  if (child.exitCode === null) child.kill('SIGKILL')
}
