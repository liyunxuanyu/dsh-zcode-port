#!/usr/bin/env node
/**
 * Make a checkout runnable: check Node/pnpm, install the locked dependency
 * graph, build every package, and report optional system tools.
 *
 * No third-party dependencies: this script must run before `pnpm install`.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'runtime/manifest.json'), 'utf8'))
const allowNode22 = process.env.ZCD_ALLOW_NODE22 === '1'
const offline = process.env.ZCD_OFFLINE === '1'

/** Compare two dotted versions numerically. */
function versionAtLeast(current, minimum) {
  const a = current.split('.').map(Number)
  const b = minimum.split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    if (left !== right) return left > right
  }
  return true
}

const nodeVersion = process.versions.node
if (!versionAtLeast(nodeVersion, manifest.nodeMinimum)) {
  if (!allowNode22) {
    console.error(`✖ Node ${nodeVersion} is below the required ${manifest.nodeMinimum}.`)
    console.error('  Install Node 24 (see .nvmrc / mise.toml), or set ZCD_ALLOW_NODE22=1 for typecheck-only work.')
    process.exit(1)
  }
  console.warn(`! Node ${nodeVersion} is below ${manifest.nodeMinimum}; continuing because ZCD_ALLOW_NODE22=1.`)
}

const pnpm = spawnSync('pnpm', ['--version'], { encoding: 'utf8', shell: true })
if (pnpm.status !== 0) {
  console.error('✖ pnpm is not available. Install pnpm 10 (see runtime/manifest.json).')
  process.exit(1)
}
console.log(`✓ Node ${nodeVersion}, pnpm ${pnpm.stdout.trim()}`)

if (!existsSync(join(root, 'node_modules')) || process.env.ZCD_FORCE_INSTALL === '1') {
  if (offline) {
    console.error('✖ ZCD_OFFLINE=1 but node_modules is missing; unpack the product tarball first.')
    process.exit(1)
  }
  console.log('→ pnpm install --frozen-lockfile')
  execFileSync('pnpm', ['install', '--frozen-lockfile'], { cwd: root, stdio: 'inherit', shell: true })
} else {
  console.log('✓ dependency tree present')
}

console.log('→ pnpm build')
execFileSync('pnpm', ['build'], { cwd: root, stdio: 'inherit', shell: true })

/** Report whether one executable is on PATH. */
function hasTool(name) {
  const probe = process.platform === 'win32'
    ? spawnSync('where', [name], { encoding: 'utf8', shell: true })
    : spawnSync('which', [name], { encoding: 'utf8' })
  return probe.status === 0
}

for (const tool of manifest.systemTools.required ?? []) {
  if (!hasTool(tool.name)) {
    console.error(`✖ required tool missing: ${tool.name} (${tool.why})`)
    process.exitCode = 1
  } else {
    console.log(`✓ ${tool.name}`)
  }
}
for (const tool of manifest.systemTools.optional ?? []) {
  console.log(`${hasTool(tool.name) ? '✓' : '○'} ${tool.name}${hasTool(tool.name) ? '' : ` (optional: ${tool.why})`}`)
}

console.log('\nnext: node scripts/link-profile.mjs && DSH_HOME=./.dsh-home npx @deepseek-ai/dsh@' + manifest.dsh + ' --profile product')
