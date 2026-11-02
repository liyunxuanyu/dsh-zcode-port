#!/usr/bin/env node
/**
 * Build a self-contained product tarball.
 *
 * The tarball contains built package output, bundles, the product profile,
 * skills, the runtime manifest, and the lockfile. `node_modules` stays out:
 * `ensure-runtime.mjs` restores it from the lockfile (or an offline vendor
 * directory).
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version ?? '0.0.0'
const outDir = join(root, 'dist')
const out = join(outDir, `zcd-product-${version}.tgz`)

execFileSync('pnpm', ['build'], { cwd: root, stdio: 'inherit', shell: true })
mkdirSync(outDir, { recursive: true })

const paths = [
  'packages', 'profiles', 'skills', 'runtime', 'scripts', 'docs',
  'README.md', 'LICENSE', 'NOTICE', 'package.json', 'pnpm-lock.yaml',
  'pnpm-workspace.yaml', 'tsconfig.base.json', 'upstream.pin.json',
].filter(path => existsSync(join(root, path)))

console.log(`→ tar ${out}`)
const result = spawnSync('tar', [
  '-czf', out,
  '--exclude=node_modules',
  '--exclude=*/node_modules',
  '--exclude=.git',
  '-C', root,
  ...paths,
], { stdio: 'inherit', shell: true })
if (result.status !== 0) {
  console.error('✖ tar failed; ensure `tar` is on PATH (Windows 10+ ships bsdtar).')
  process.exit(result.status ?? 1)
}
console.log(`✓ ${out}`)
