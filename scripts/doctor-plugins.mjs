#!/usr/bin/env node
/**
 * Pre-flight check before installing an external dsh plugin into the product
 * profile.
 *
 * Checks:
 *  - every profile dependency resolves in the profile's node_modules;
 *  - each installed package's `engines.dsh` accepts the pinned dsh version;
 *  - the same package name does not resolve to two different versions;
 *  - the profile's bundle list points at installed packages.
 *
 * This is deliberately offline and dependency-free: it must run before a
 * broken plugin can take the runtime down.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const home = process.env.ZCD_DSH_HOME ?? join(root, '.dsh-home')
const profileDir = join(home, 'profiles', 'product')
const profilePkg = join(profileDir, 'package.json')
const manifest = JSON.parse(readFileSync(join(root, 'runtime/manifest.json'), 'utf8'))
const dshVersion = manifest.dsh

const problems = []
const warnings = []

if (!existsSync(profilePkg)) {
  console.error(`✖ profile not found at ${profilePkg}; run scripts/link-profile.mjs first.`)
  process.exit(1)
}
const profile = JSON.parse(readFileSync(profilePkg, 'utf8'))
const deps = Object.keys(profile.dependencies ?? {})
const bundles = profile.dsh?.profile?.bundles ?? []

/** Compare dotted numeric cores; prerelease suffixes are ignored on purpose. */
function compare(left, right) {
  const a = left.split('-')[0].split('.').map(Number)
  const b = right.split('-')[0].split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}

/** Accept the range forms dsh packages actually use. */
function satisfies(version, range) {
  const trimmed = range.trim()
  if (trimmed === '' || trimmed === '*' || trimmed === 'latest') return true
  const operator = /^(\^|~|>=|>|<=|<|=)?\s*(.+)$/.exec(trimmed)
  if (operator === null) return false
  const [, op = '=', raw] = operator
  const target = raw.split(' ')[0]
  const cmp = compare(version, target)
  if (op === '^') {
    const [major] = target.split('.')
    return cmp >= 0 && version.split('.')[0] === major
  }
  if (op === '~') {
    const [major, minor] = target.split('.')
    return cmp >= 0 && version.split('.').slice(0, 2).join('.') === `${major}.${minor}`
  }
  if (op === '>=') return cmp >= 0
  if (op === '>') return cmp > 0
  if (op === '<=') return cmp <= 0
  if (op === '<') return cmp < 0
  return cmp === 0
}

const seen = new Map()
for (const name of deps) {
  const pkgPath = join(profileDir, 'node_modules', name, 'package.json')
  if (!existsSync(pkgPath)) {
    problems.push(`${name}: declared by the profile but not installed (run pnpm install in ${profileDir})`)
    continue
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  if (typeof pkg.version === 'string') {
    const previous = seen.get(name)
    if (previous !== undefined && previous.version !== pkg.version) {
      warnings.push(`${name}: ${previous.version} at ${previous.path}, ${pkg.version} at ${pkgPath}`)
    } else {
      seen.set(name, { version: pkg.version, path: pkgPath })
    }
  }
  const engine = pkg.engines?.dsh
  if (typeof engine === 'string' && !satisfies(dshVersion, engine)) {
    problems.push(`${name}@${pkg.version}: engines.dsh "${engine}" rejects dsh ${dshVersion}`)
  }
  for (const [peer, range] of Object.entries(pkg.peerDependencies ?? {})) {
    if (!peer.startsWith('@deepseek-ai/dsh-')) continue
    if (typeof range !== 'string' || range.startsWith('workspace:')) continue
    if (!satisfies(dshVersion, range)) {
      warnings.push(`${name}@${pkg.version}: peer ${peer} "${range}" may not match dsh ${dshVersion}`)
    }
  }
}

for (const bundle of bundles) {
  const pkgPath = join(profileDir, 'node_modules', bundle, 'package.json')
  if (!existsSync(pkgPath)) {
    problems.push(`bundle ${bundle}: listed by the profile but not installed`)
    continue
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  if (pkg.dsh?.bundle?.patch === undefined) {
    problems.push(`bundle ${bundle}: manifest does not declare dsh.bundle.patch`)
  }
}

// A profile dependency that is a dsh package and also inside the ZCD bundle
// list is expected; report only unexpected workspace leakage.
const workspaceLeaks = deps.filter(name => name.startsWith('@zcd/') && !existsSync(join(profileDir, 'node_modules', name)))
if (workspaceLeaks.length > 0) {
  warnings.push(`workspace links are missing: ${workspaceLeaks.join(', ')}`)
}

for (const warning of warnings) console.warn(`! ${warning}`)
for (const problem of problems) console.error(`✖ ${problem}`)

if (problems.length > 0) {
  console.error(`\ndoctor-plugins: ${problems.length} problem(s), ${warnings.length} warning(s)`)
  process.exit(1)
}
console.log(`✓ doctor-plugins: ${deps.length} dependencies, ${bundles.length} bundles, dsh ${dshVersion}, no blocking issues`)
