#!/usr/bin/env node
/**
 * Fetch the pinned dsh checkout into `upstream/dsh` (gitignored).
 *
 * The product itself depends on the published npm packages at the same
 * version; this checkout exists for contract comparison and for running the
 * upstream gates when a seam changes.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pin = JSON.parse(readFileSync(join(root, 'upstream.pin.json'), 'utf8'))
const target = join(root, 'upstream', 'dsh')

mkdirSync(join(root, 'upstream'), { recursive: true })
if (existsSync(join(target, '.git'))) {
  console.log(`→ fetch ${pin.ref}`)
  execFileSync('git', ['fetch', '--depth', '1', 'origin', pin.ref], { cwd: target, stdio: 'inherit' })
  execFileSync('git', ['checkout', '--detach', 'FETCH_HEAD'], { cwd: target, stdio: 'inherit' })
} else {
  console.log(`→ clone ${pin.repo} @ ${pin.ref}`)
  execFileSync('git', ['clone', '--depth', '1', '--branch', pin.ref, pin.repo, target], { stdio: 'inherit' })
}
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: target, encoding: 'utf8' }).trim()
console.log(`✓ upstream ${pin.version} at ${head}`)
