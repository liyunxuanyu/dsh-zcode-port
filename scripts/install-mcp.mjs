#!/usr/bin/env node
/**
 * Install the pinned MCP runtime under `runtime/mcp` without joining the
 * repository workspace (the profile/package graph must stay separate).
 */
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'runtime', 'mcp')
console.log(`→ pnpm install in ${dir}`)
execFileSync('pnpm', ['install', '--ignore-workspace'], { cwd: dir, stdio: 'inherit', shell: true })
console.log('✓ MCP runtime installed')
