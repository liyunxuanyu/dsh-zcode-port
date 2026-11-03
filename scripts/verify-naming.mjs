#!/usr/bin/env node
/**
 * Naming and packaging gates.
 *
 * - every tool registration in `packages/**` uses a snake_case wire name
 * - no ZCD tool shadows a dsh built-in name
 * - every `SKILL.md` in `skills/**` references only tools that exist somewhere
 *   in this repo or in the pinned dsh package list
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const RESERVED = new Set([
  'bash', 'pwsh', 'read', 'write', 'edit', 'apply_patch', 'read_image',
  'glob', 'grep', 'web_fetch', 'web_search', 'todo_write', 'skill',
  'ask_user_question', 'exit_plan_mode', 'subagent', 'subagent_fork',
  'send_message', 'list_agents', 'interrupt_agent', 'present', 'lsp',
  'job_list', 'job_output', 'job_kill', 'run_code', 'workflow', 'ralph',
  'working_directory', 'create_worktree', 'plugin_manager', 'plugin_market',
])

const problems = []

/** Recursively list files under a directory. */
function walk(dir) {
  if (!statSafe(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'lib') continue
      out.push(...walk(path))
    } else {
      out.push(path)
    }
  }
  return out
}

/** `statSync` that returns undefined instead of throwing. */
function statSafe(path) {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}

const toolNames = new Set()

for (const file of walk(join(root, 'packages'))) {
  if (!file.endsWith('.ts') || file.endsWith('.d.ts')) continue
  const source = readFileSync(file, 'utf8')
  for (const match of source.matchAll(/defineTool\(\{\s*name:\s*'([a-z0-9_]+)'/g)) {
    const name = match[1]
    if (!/^[a-z][a-z0-9_]{2,40}$/.test(name)) {
      problems.push(`${relative(root, file)}: tool name "${name}" is not snake_case`)
    }
    if (RESERVED.has(name)) {
      problems.push(`${relative(root, file)}: tool name "${name}" shadows a dsh built-in`)
    }
    toolNames.add(name)
  }
}

const ZCODE_TOOL_NAMES = new Set([
  'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebFetch', 'WebSearch',
  'TodoRead', 'TodoWrite', 'Agent', 'Task', 'SendMessage', 'TaskOutput',
  'TaskStop', 'Skill', 'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode',
  'CreateWorkflow', 'AmendWorkflow', 'SaveWorkflow', 'EvalWorkflowSnippet',
  'ListWorkflowRuns', 'GetWorkflowRun', 'ResumeWorkflowRun', 'FillWorkflowHole',
  'ResolveWorkflowQuestion', 'ListSavedWorkflows', 'ListModels',
  'ReadSessionContext', 'CronCreate', 'CronList', 'CronUpdate', 'CronDelete',
  'CronPauseSelf', 'OffPeakCreate', 'OffPeakList',
])

// A skill whose frontmatter does not parse is dropped by the provider without
// any warning: it simply never appears in the catalog, so `skill({name})`
// answers "unknown". A bare `description: text: with a colon` is the trap —
// YAML reads the second colon as a nested mapping. Failing here keeps that
// class of skill from silently disappearing.
for (const file of walk(join(root, 'skills'))) {
  if (!file.endsWith('SKILL.md')) continue
  const source = readFileSync(file, 'utf8')
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)
  if (block === null) {
    problems.push(`${relative(root, file)}: missing YAML frontmatter`)
    continue
  }
  let parsed
  try {
    parsed = parseYaml(block[1])
  } catch (error) {
    problems.push(`${relative(root, file)}: frontmatter does not parse (${error.message.split('\n')[0]})`)
    continue
  }
  if (typeof parsed?.name !== 'string' || parsed.name.trim().length === 0) {
    problems.push(`${relative(root, file)}: frontmatter needs a non-empty name`)
  } else if (!file.includes(`${parsed.name}/SKILL.md`)) {
    problems.push(`${relative(root, file)}: directory does not match frontmatter name "${parsed.name}"`)
  }
  if (typeof parsed?.description !== 'string' || parsed.description.trim().length === 0) {
    problems.push(`${relative(root, file)}: frontmatter needs a non-empty description`)
  }
}

// Ported skills must not reference ZCode's PascalCase wire names. Only
// backticked names are checked: prose may legitimately say "Agent" or "Task".
for (const file of walk(join(root, 'skills'))) {
  if (!file.endsWith('SKILL.md')) continue
  const source = readFileSync(file, 'utf8')
  for (const match of source.matchAll(/`([A-Z][A-Za-z]+)`/g)) {
    const token = match[1]
    if (ZCODE_TOOL_NAMES.has(token)) {
      problems.push(`${relative(root, file)}: still references ZCode tool "${token}"`)
    }
  }
}

if (problems.length > 0) {
  console.error('verify-naming failed:')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log(`verify-naming: ok (${toolNames.size} ZCD tools, ${RESERVED.size} reserved names)`)
