const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')
const files = []
const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
  const p = path.join(d, e.name)
  if (e.isDirectory()) { if (e.name !== 'archive' && e.name !== 'upstream' && e.name !== 'node_modules') walk(p) }
  else if (e.name.endsWith('.md')) files.push(p)
})
walk(root)

let problems = 0
const linkRe = /\]\(([^)]+)\)/g
const stripFences = s => s.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
for (const f of files) {
  const s = stripFences(fs.readFileSync(f, 'utf8'))
  for (const m of s.matchAll(linkRe)) {
    const l = m[1]
    if (l.startsWith('http') || l.startsWith('#')) continue
    const target = path.resolve(path.dirname(f), l.split('#')[0])
    if (!fs.existsSync(target)) { console.log('MISSING LINK', path.relative(root, f), '->', l); problems++ }
  }
}

// WP refs
const wpFile = path.join(root, 'docs/03-work-packages.md')
const wpText = fs.readFileSync(wpFile, 'utf8')
const wpIds = new Set([...wpText.matchAll(/^## (WP-\d+)/gm)].map(m => m[1]))
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8')
  for (const m of s.matchAll(/\bWP-(\d{2})\b/g)) {
    const id = 'WP-' + m[1]
    if (!wpIds.has(id)) { console.log('UNKNOWN WP', path.relative(root, f), id); problems++ }
  }
}

// tool names used in docs that should be snake_case (spot check common PascalCase leftovers)
const badTools = ['CreateWorkflow', 'AmendWorkflow', 'SaveWorkflow', 'EvalWorkflowSnippet', 'GetWorkflowRun', 'ListWorkflowRuns', 'ResumeWorkflowRun', 'FillWorkflowHole', 'ReadSessionContext']
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8')
  // allow mentions in mapping tables / ZCode context; only flag in docs/04,05,06,07 (our own specs)
  if (!/docs\/(04|05|06|07)/.test(f)) continue
  for (const t of badTools) {
    if (s.includes('`' + t + '`')) { console.log('PASCAL TOOL IN SPEC', path.relative(root, f), t); problems++ }
  }
}

console.log('checked', files.length, 'markdown files; problems:', problems)
process.exit(problems ? 1 : 0)
