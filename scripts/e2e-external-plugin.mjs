#!/usr/bin/env node
/**
 * End-to-end check that the product profile accepts a real external plugin.
 *
 * `doctor-plugins.mjs` is static: it reads manifests and never boots anything.
 * This script closes that gap with the exact sequence an operator follows:
 *
 * 1. copy the materialised product profile into a scratch home;
 * 2. install the out-of-workspace fixture with `file:` (the same resolution
 *    path an npm package would take) plus the extra `link:` entries the copy
 *    needs, because a profile's own `link:` deps point at this checkout;
 * 3. append the plugin to the profile's user patch layer;
 * 4. boot `dsh --profile product` and assert the probe route answers.
 *
 * Nothing here touches the real profile: `ZCD_DSH_HOME` for the scratch copy is
 * a temporary directory, and the real `.dsh-home` is never written.
 *
 * Exit codes: 0 pass, 1 assertion failure, 2 environment problem (no profile,
 * no dsh binary, no network for the fixture install).
 */

import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceHome = resolve(process.env.ZCD_DSH_HOME ?? join(root, '.dsh-home'))
const sourceProfile = join(sourceHome, 'profiles', 'product')
const bin = join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
const fixture = join(root, 'e2e/fixtures/external-plugin')

/** Print and exit with a code. */
function fail(message, code = 1) {
  console.error(`✖ ${message}`)
  process.exit(code)
}

if (!existsSync(bin)) fail(`dsh is not installed at ${bin}; run pnpm install first.`, 2)
if (!existsSync(sourceProfile)) fail(`profile missing at ${sourceProfile}; run scripts/link-profile.mjs first.`, 2)

const scratch = mkdtempSync(join(tmpdir(), 'zcd-plugin-e2e-'))
const home = join(scratch, 'home')
const profileDir = join(home, 'profiles', 'product')

console.log(`→ scratch home: ${home}`)
cpSync(sourceProfile, profileDir, {
  recursive: true,
  // node_modules is re-linked below; copying it would take minutes and would
  // keep the copy pointing at the original profile's resolution graph.
  filter: source => !source.includes('node_modules'),
})

// The copied manifest lists every ZCD package as `link:` to this checkout.
// `file:` deps of the fixture need those same packages, so keep the links and
// add the fixture as a directory dependency.
const manifestPath = join(profileDir, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.dependencies = {
  ...manifest.dependencies,
  '@zcd-e2e/probe': `file:${fixture.split('\\').join('/')}`,
}
manifest.pnpm = manifest.pnpm ?? {}
manifest.pnpm.ignoredBuiltDependencies = manifest.pnpm.ignoredBuiltDependencies ?? [
  '@deepseek-ai/dsh-subprocess-local',
  '@google/genai',
  'koffi',
  'node-pty',
  'protobufjs',
]
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

// An external plugin is a *user layer* entry, not a bundle row.
//
// `cordis.patch.yml` patches entries **by id**: a bare `- id: x, name: y` row
// only overrides an existing entry and is silently dropped ("patch: entry not
// found") otherwise. Adding a plugin therefore needs an explicit `insert`
// wrapper. Getting this wrong is exactly what this test exists to catch.
const patchPath = join(profileDir, 'cordis.patch.yml')
const existingPatch = readFileSync(patchPath, 'utf8')
const probeRow = `    - id: e2e-probe\n      name: '@zcd-e2e/probe'\n`
const insertBlock = `- insert:\n${probeRow}`
writeFileSync(patchPath, existingPatch.includes('\n[]')
  ? existingPatch.replace('\n[]', `\n${insertBlock}`)
  : existingPatch.replace(/^\[\]\s*$/m, insertBlock))

console.log('→ installing the external plugin into the scratch profile')
const install = spawn('pnpm', ['install', '--ignore-workspace', '--config.strict-dep-builds=false'], {
  cwd: profileDir,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let installOut = ''
install.stdout.on('data', chunk => { installOut += chunk })
install.stderr.on('data', chunk => { installOut += chunk })
const installCode = await new Promise(resolveCode => install.on('exit', resolveCode))
if (installCode !== 0) {
  console.error(installOut)
  rmSync(scratch, { recursive: true, force: true })
  fail('the scratch profile install failed', 2)
}

const installed = join(profileDir, 'node_modules', '@zcd-e2e', 'probe', 'index.js')
if (!existsSync(installed)) {
  rmSync(scratch, { recursive: true, force: true })
  fail('the external plugin did not resolve from the profile node_modules')
}

console.log('→ booting the profile with the external plugin loaded')
const child = spawn(process.execPath, [bin, '--profile', 'product', '--no-open', '--port', '0'], {
  cwd: root,
  env: { ...process.env, DSH_HOME: home },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let stdout = ''
let stderr = ''
child.stdout.on('data', chunk => { stdout += chunk })
child.stderr.on('data', chunk => { stderr += chunk })

/** Wait for the printed Web URL. */
function waitForUrl(timeoutMs) {
  return new Promise((resolveUrl, rejectUrl) => {
    const deadline = Date.now() + timeoutMs
    const timer = setInterval(() => {
      const match = stdout.match(/http:\/\/127\.0\.0\.1:(\d+)\/\?token=([A-Za-z0-9_-]+)/)
      if (match !== null) {
        clearInterval(timer)
        resolveUrl({ port: Number(match[1]) })
      } else if (Date.now() > deadline) {
        clearInterval(timer)
        rejectUrl(new Error(`no Web URL after ${timeoutMs}ms\nstdout:\n${stdout}\nstderr:\n${stderr}`))
      } else if (child.exitCode !== null) {
        clearInterval(timer)
        rejectUrl(new Error(`dsh exited early (${child.exitCode})\nstderr:\n${stderr}`))
      }
    }, 250)
  })
}

let exitCode = 0
try {
  const { port } = await waitForUrl(90_000)
  if (stderr.includes('did not activate')) {
    throw new Error(`a plugin failed to activate:\n${stderr}`)
  }
  const response = await fetch(`http://127.0.0.1:${port}/e2e-probe/health`)
  const body = await response.json().catch(() => undefined)
  if (response.status !== 200 || body?.ok !== true || body?.plugin !== 'zcd-e2e-probe') {
    throw new Error(`the external plugin did not serve its route: ${response.status} ${JSON.stringify(body)}`)
  }
  console.log(`✓ external plugin loaded and served /e2e-probe/health on :${port}`)
} catch (error) {
  console.error(`✖ ${error instanceof Error ? error.message : String(error)}`)
  exitCode = 1
} finally {
  child.kill('SIGTERM')
  await new Promise(resolveExit => {
    if (child.exitCode !== null) return resolveExit()
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolveExit() }, 5_000)
    child.on('exit', () => { clearTimeout(timer); resolveExit() })
  })
  rmSync(scratch, { recursive: true, force: true })
}

process.exit(exitCode)
