#!/usr/bin/env node
/**
 * Materialise the product profile under `$DSH_HOME/profiles/product` with
 * absolute `link:` dependencies to this checkout.
 *
 * dsh reads profiles from the Harness home, not from an arbitrary directory.
 * Linking (instead of copying) keeps `pnpm build` results live while developing
 * and avoids a second install of the same workspace packages.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const home = resolve(process.env.ZCD_DSH_HOME ?? join(root, '.dsh-home'))
const profileDir = join(home, 'profiles', 'product')
const directories = {
  '@zcd/deferred-tools': 'packages/deferred-tools',
  '@zcd/document-view': 'packages/document-view',
  '@zcd/documents-ui-host': 'packages/documents-ui-host',
  '@zcd/status-host': 'packages/status-host',
  '@zcd/client-ui-settings-zcd': 'packages/client-ui-settings-zcd',
  '@zcd/workflow-ui-host': 'packages/workflow-ui-host',
  '@zcd/client-ui-workflow': 'packages/client-ui-workflow',
  '@zcd/client-ui-zcd': 'packages/client-ui-zcd',
  '@zcd/client-ui-genui': 'packages/client-ui-genui',
  '@zcd/browser-ui-host': 'packages/browser-ui-host',
  '@zcd/client-ui-browser': 'packages/client-ui-browser',
  '@zcd/bundle-base': 'packages/bundle-base',
  '@zcd/bundle-web-app': 'packages/bundle-web-app',
  '@zcd/policy-plan-readonly': 'packages/policy-plan-readonly',
  '@zcd/policy-skill-gate': 'packages/policy-skill-gate',
  '@zcd/genui-host': 'packages/genui-host',
  '@zcd/tool-visualize': 'packages/tool-visualize',
  '@zcd/memory': 'packages/memory',
  '@zcd/memory-ui-host': 'packages/memory-ui-host',
  '@zcd/browser': 'packages/browser',
  '@zcd/tool-browser': 'packages/tool-browser',
  '@zcd/durable-workflow': 'packages/durable-workflow',
  '@zcd/workflow-store': 'packages/workflow-store',
  '@zcd/tool-workflow': 'packages/tool-workflow',
  '@zcd/offpeak': 'packages/offpeak',
  '@zcd/tool-memory': 'packages/tool-memory',
  '@zcd/tool-offpeak': 'packages/tool-offpeak',
  '@zcd/tool-models': 'packages/tool-models',
  '@zcd/tool-session': 'packages/tool-session',
  '@zcd/tool-documents': 'packages/tool-documents',
  '@zcd/tool-office': 'packages/tool-office',
  '@zcd/tool-plan-mode': 'packages/tool-plan-mode',
  '@zcd/tool-search': 'packages/tool-search',
  '@zcd/tool-todo-read': 'packages/tool-todo-read',
}

const sourceProfile = JSON.parse(readFileSync(join(root, 'profiles/product/package.json'), 'utf8'))
const dependencies = Object.fromEntries(
  Object.entries(sourceProfile.dependencies ?? {}).map(([name, version]) => {
    const directory = directories[name]
    return [name, directory === undefined
      ? version
      : `link:${join(root, directory).split('\\').join('/')}`]
  }),
)

// Linked packages resolve their own third-party imports from the profile tree
// at runtime. Copy concrete versions from each linked package so a clean
// install (and an offline pack) does not depend on the workspace root.
for (const directory of Object.values(directories)) {
  const manifestPath = join(root, directory, 'package.json')
  if (!existsSync(manifestPath)) continue
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
    if (name.startsWith('@zcd/') || name.startsWith('@deepseek-ai/')) continue
    if (typeof version !== 'string' || version.startsWith('workspace:')) continue
    dependencies[name] = version
  }
}

const manifest = {
  ...sourceProfile,
  dependencies,
}

if (!existsSync(join(root, 'packages/tool-search/lib/index.js'))) {
  console.error('✖ packages are not built; run `pnpm build` (or scripts/ensure-runtime.mjs) first.')
  process.exit(1)
}

mkdirSync(profileDir, { recursive: true })
writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
copyFileSync(join(root, 'profiles/product/cordis.patch.yml'), join(profileDir, 'cordis.patch.yml'))

console.log(`→ pnpm install in ${profileDir}`)
execFileSync('pnpm', ['install', '--ignore-workspace'], { cwd: profileDir, stdio: 'inherit', shell: true })

console.log(`\n✓ profile ready: ${profileDir}`)
console.log(`  DSH_HOME=${home} (set ZCD_DSH_HOME to override)`)
console.log(`  dsh --profile product --dump-config`)
