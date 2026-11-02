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
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const bin = join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
const home = process.env.ZCD_DSH_HOME ?? join(root, '.dsh-home')
const profile = join(home, 'profiles/product')
const genuiDir = join(home, 'storages', 'zcd-genui', '__smoke__')

if (!existsSync(bin)) {
  console.error('✖ dsh is not installed; run `pnpm install` first.')
  process.exit(1)
}
if (!existsSync(profile)) {
  console.error(`✖ profile missing at ${profile}; run scripts/link-profile.mjs first.`)
  process.exit(1)
}

mkdirSync(genuiDir, { recursive: true })
writeFileSync(join(genuiDir, 'probe.html'), '<!doctype html><h1>zcd genui smoke</h1>')

const child = spawn(process.execPath, [bin, '--profile', 'product', '--no-open', '--port', '0'], {
  cwd: root,
  env: { ...process.env, DSH_HOME: home },
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

  const status = await fetch(`http://127.0.0.1:${port}/zcd/status`)
  const statusBody = await status.json().catch(() => undefined)
  if (status.status !== 200 || statusBody?.product !== 'ZCD') {
    throw new Error(`status route failed: ${status.status}`)
  }

  const workflow = await fetch(`http://127.0.0.1:${port}/zcd/workflow/runs/not-a-run`)
  const workflowBody = await workflow.text()
  if (workflow.status !== 404 || !workflowBody.includes('not-found')) {
    throw new Error(`workflow route failed: ${workflow.status} ${workflowBody}`)
  }
  const cancel = await fetch(`http://127.0.0.1:${port}/zcd/workflow/runs/not-a-run/cancel`, { method: 'POST' })
  if (cancel.status !== 404) throw new Error(`workflow cancel route failed: ${cancel.status}`)

  // Client cards must be in the browser boot graph and their bundles served.
  const login = await fetch(`http://127.0.0.1:${port}/?token=${token}`, { redirect: 'manual' })
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  const page = await fetch(`http://127.0.0.1:${port}/`, { headers: cookie === '' ? {} : { cookie } })
  const html = await page.text()
  for (const [id, marker] of [
    ['@zcd/client-ui-genui', 'tool.call.toolview'],
    ['@zcd/client-ui-zcd', 'read_document'],
    ['@zcd/client-ui-settings-zcd', 'settings.section'],
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
