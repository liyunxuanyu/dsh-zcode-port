#!/usr/bin/env node
/**
 * Link the repository skill library into `$DSH_HOME/skills`.
 *
 * dsh's filesystem skill provider discovers directory bundles at the top level
 * of a root. The repository keeps categories (`skills/superpowers/<name>`), so
 * this script exposes each bundle as a top-level entry via a directory link
 * (a junction on Windows). It is idempotent and never deletes a user skill
 * that happens to share a name: an existing non-link entry is left untouched.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const home = resolve(process.env.ZCD_DSH_HOME ?? join(root, '.dsh-home'))
const target = join(home, 'skills')
const source = join(root, 'skills')

mkdirSync(target, { recursive: true })

let linked = 0
let skipped = 0
for (const category of readdirSync(source, { withFileTypes: true })) {
  if (!category.isDirectory()) continue
  const categoryDir = join(source, category.name)
  for (const entry of readdirSync(categoryDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const skillDir = join(categoryDir, entry.name)
    if (!existsSync(join(skillDir, 'SKILL.md'))) continue
    const dest = join(target, entry.name)
    if (existsSync(dest) || isLink(dest)) {
      // Replace only a link we own (its target is inside this repository).
      if (isLink(dest) && readlinkSync(dest).includes(root)) {
        rmSync(dest, { recursive: true, force: true })
      } else {
        skipped++
        continue
      }
    }
    symlinkSync(skillDir, dest, process.platform === 'win32' ? 'junction' : 'dir')
    linked++
  }
}

/** Whether a path is a symbolic link or junction. */
function isLink(path) {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

console.log(`✓ skills: ${linked} linked, ${skipped} skipped (existing non-repo entries) in ${target}`)
