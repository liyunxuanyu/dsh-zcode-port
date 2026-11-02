#!/usr/bin/env node
/**
 * Smoke the pinned MCP server over stdio.
 *
 * This proves the runtime under `runtime/mcp/` is not just a lockfile: the
 * pinned `server-everything` starts, completes the MCP initialize handshake,
 * and lists at least one tool. It does not mount the server into the product
 * profile, so it is safe to run in CI and locally.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const entry = join(root, 'runtime/mcp/node_modules/@modelcontextprotocol/server-everything/dist/index.js')

if (!existsSync(entry)) {
  console.error('✖ MCP runtime missing; run `node scripts/install-mcp.mjs` first.')
  process.exit(1)
}

const child = spawn(process.execPath, [entry], { stdio: ['pipe', 'pipe', 'pipe'] })
let stdout = ''
let stderr = ''
child.stdout.on('data', chunk => { stdout += chunk })
child.stderr.on('data', chunk => { stderr += chunk })

/** Send one JSON-RPC message on its own line. */
function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`)
}

/** Wait for one response id, then return its parsed payload. */
function waitFor(id, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const timer = setInterval(() => {
      for (const line of stdout.split('\n')) {
        if (line.trim().length === 0) continue
        try {
          const value = JSON.parse(line)
          if (value.id === id) {
            clearInterval(timer)
            resolve(value)
            return
          }
        } catch {
          // Partial lines and server logs are not protocol responses.
        }
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer)
        reject(new Error(`MCP response ${id} timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`))
      }
      if (child.exitCode !== null) {
        clearInterval(timer)
        reject(new Error(`MCP server exited (${child.exitCode})\nstderr:\n${stderr}`))
      }
    }, 100)
  })
}

try {
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'zcd-check', version: '0' },
    },
  })
  const initialized = await waitFor(1)
  if (initialized.error !== undefined) {
    throw new Error(`MCP initialize failed: ${JSON.stringify(initialized.error)}`)
  }
  send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  const listed = await waitFor(2)
  if (listed.error !== undefined) {
    throw new Error(`MCP tools/list failed: ${JSON.stringify(listed.error)}`)
  }
  const tools = listed.result?.tools
  if (!Array.isArray(tools) || tools.length === 0) {
    throw new Error(`MCP server listed no tools: ${JSON.stringify(listed.result)}`)
  }
  console.log(`✓ MCP ${initialized.result?.serverInfo?.name ?? 'server'} exposes ${tools.length} tools (pinned runtime)`)
} finally {
  child.kill('SIGTERM')
  await new Promise(resolve => setTimeout(resolve, 300))
  if (child.exitCode === null) child.kill('SIGKILL')
}
