/**
 * Read-only command classification.
 *
 * Fail-closed by construction: anything the parser does not positively prove
 * read-only returns `unknown`, and the caller then leaves the request to the
 * normal approval chain. Only single, simple commands are considered; pipes,
 * redirections, substitutions, `&&`/`||`/`;`, heredocs, and subshells are all
 * `unknown` even when every part would be read-only on its own, because the
 * composed effect is not analysed.
 *
 * @module @zcd/policy-bash-readonly/classify
 */

/** Classification result for one command line. */
export type Classification =
  | { readonly kind: 'read-only'; readonly reason: string }
  | { readonly kind: 'unknown'; readonly reason: string }

/** Commands that never mutate files, processes, or remote state. */
const READ_ONLY_COMMANDS = new Set([
  'ls', 'pwd', 'cat', 'head', 'tail', 'wc', 'stat', 'file', 'du', 'df',
  'find', 'grep', 'rg', 'which', 'whoami', 'uname', 'date', 'basename',
  'dirname', 'realpath', 'readlink', 'cut', 'tr', 'sort', 'uniq', 'column',
  'jq', 'echo', 'printf', 'true', 'false', 'test', '[', 'type', 'command',
])

/** Commands that are read-only only for specific subcommands. */
const SUBCOMMAND_READ_ONLY: Readonly<Record<string, ReadonlySet<string>>> = {
  git: new Set([
    'status', 'log', 'diff', 'show', 'branch', 'tag', 'remote', 'rev-parse',
    'describe', 'blame', 'shortlog', 'ls-files', 'ls-tree', 'show-ref',
    'config', 'reflog', 'cat-file', 'name-rev', 'merge-base', 'grep',
  ]),
  gh: new Set(['pr', 'issue', 'repo', 'run', 'release', 'api', 'auth', 'search']),
  npm: new Set(['view', 'ls', 'list', 'outdated', 'config']),
  pnpm: new Set(['list', 'ls', 'outdated', 'view', 'why']),
  docker: new Set(['ps', 'images', 'logs', 'inspect', 'version', 'info']),
  kubectl: new Set(['get', 'describe', 'logs', 'version', 'explain']),
  cargo: new Set(['metadata', 'tree', 'search']),
  go: new Set(['version', 'env', 'list']),
  node: new Set(['--version', '-v']),
}

/** Flags that turn an otherwise read-only command into a mutating one. */
const MUTATING_FLAGS = new Set([
  '-delete', '--delete', '-exec', '--exec', '-execdir', '-ok', '-okdir',
  '-fprint', '-fprint0', '-fprintf', '-fls', '-output', '--output',
  '--out', '--write', '--fix', '--in-place',
])

/** Tokens that prove we cannot analyse the composed effect. */
const UNANALYSABLE = [
  '>', '>>', '<', '<<', '|', '||', '&', '&&', ';', '$(' , '`', '<<<', '&>',
]

/**
 * Split a command line into simple words, honouring single and double quotes.
 *
 * Returns `undefined` when quoting is unbalanced: an ambiguous parse is never
 * promoted to read-only.
 * @param line - raw command line.
 * @returns words, or undefined when the line cannot be tokenized safely.
 */
export function splitWords(line: string): string[] | undefined {
  const words: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined
  let started = false
  for (const char of line) {
    if (quote !== undefined) {
      if (char === quote) quote = undefined
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      started = true
      continue
    }
    if (char === ' ' || char === '\t' || char === '\n') {
      if (started) {
        words.push(current)
        current = ''
        started = false
      }
      continue
    }
    current += char
    started = true
  }
  if (quote !== undefined) return undefined
  if (started) words.push(current)
  return words
}

/**
 * Classify a `git` invocation conservatively.
 * @param args - arguments after `git`.
 * @returns the classification.
 */
function classifyGit(args: readonly string[]): Classification {
  const sub = args.find(arg => !arg.startsWith('-'))
  if (sub === undefined) return { kind: 'unknown', reason: 'git without a subcommand' }
  const writes = args.some(arg =>
    ['-d', '-D', '-m', '-M', '-c', '-C', '--delete', '--move', '--copy', '--set', '--unset', '--add', '--replace-all'].includes(arg))
  if (writes) return { kind: 'unknown', reason: `git ${sub} has a mutating flag` }
  if (sub === 'branch') {
    const listing = args.some(arg => ['--list', '-l', '-a', '-r', '-v', '--all', '--remotes'].includes(arg))
    return listing
      ? { kind: 'read-only', reason: 'git branch listing' }
      : { kind: 'unknown', reason: 'git branch without a listing flag may mutate' }
  }
  if (sub === 'tag') {
    const listing = args.some(arg => arg === '--list' || arg === '-l')
    return listing
      ? { kind: 'read-only', reason: 'git tag --list' }
      : { kind: 'unknown', reason: 'git tag without --list may create or delete' }
  }
  if (sub === 'remote') {
    const view = args.length === 1 || args.some(arg => arg === '-v' || arg === '--verbose' || arg === 'show')
    return view
      ? { kind: 'read-only', reason: 'git remote view' }
      : { kind: 'unknown', reason: 'git remote without -v may mutate' }
  }
  if (sub === 'config') {
    const read = args.some(arg =>
      ['--get', '--get-all', '--list', '-l', '--show-origin', '--show-scope'].includes(arg))
    return read
      ? { kind: 'read-only', reason: 'git config read form' }
      : { kind: 'unknown', reason: 'git config without a read flag' }
  }
  if (sub === 'stash' || sub === 'worktree' || sub === 'submodule') {
    const list = args.some(arg => arg === 'list' || arg === 'status')
    return list
      ? { kind: 'read-only', reason: `git ${sub} listing` }
      : { kind: 'unknown', reason: `git ${sub} without list/status` }
  }
  const allowed = new Set([
    'status', 'log', 'diff', 'show', 'rev-parse', 'describe', 'blame',
    'shortlog', 'ls-files', 'ls-tree', 'show-ref', 'reflog', 'cat-file',
    'name-rev', 'merge-base', 'grep',
  ])
  return allowed.has(sub)
    ? { kind: 'read-only', reason: `git ${sub} is read-only` }
    : { kind: 'unknown', reason: `git ${sub} is not in the read-only list` }
}

/**
 * Classify a `gh` invocation conservatively.
 * @param args - arguments after `gh`.
 * @returns the classification.
 */
function classifyGh(args: readonly string[]): Classification {
  const [group, action] = args.filter(arg => !arg.startsWith('-'))
  if (group === undefined) return { kind: 'unknown', reason: 'gh without a subcommand' }
  const allowed: Readonly<Record<string, readonly string[]>> = {
    pr: ['view', 'list', 'diff', 'checks', 'status'],
    issue: ['view', 'list', 'status'],
    repo: ['view', 'list'],
    run: ['view', 'list'],
    release: ['view', 'list'],
    auth: ['status'],
    search: ['repos', 'issues', 'prs', 'code', 'commits'],
  }
  const actions = allowed[group]
  if (actions === undefined) return { kind: 'unknown', reason: `gh ${group} is not read-only` }
  if (action === undefined) return { kind: 'unknown', reason: `gh ${group} without an action` }
  return actions.includes(action)
    ? { kind: 'read-only', reason: `gh ${group} ${action} is read-only` }
    : { kind: 'unknown', reason: `gh ${group} ${action} is not in the read-only list` }
}

/**
 * Classify one shell command.
 * @param command - the exact `command` argument handed to the bash tool.
 * @returns a positive read-only proof, or `unknown` with the reason.
 */
export function classifyCommand(command: string): Classification {
  const trimmed = command.trim()
  if (trimmed.length === 0) {
    return { kind: 'unknown', reason: 'empty command' }
  }
  for (const token of UNANALYSABLE) {
    if (trimmed.includes(token)) {
      return { kind: 'unknown', reason: `composed shell syntax (${token}) is not analysed` }
    }
  }
  const words = splitWords(trimmed)
  if (words === undefined || words.length === 0) {
    return { kind: 'unknown', reason: 'unbalanced quoting' }
  }
  const [program, ...args] = words
  if (program === undefined) {
    return { kind: 'unknown', reason: 'missing program' }
  }
  for (const arg of args) {
    if (MUTATING_FLAGS.has(arg)) {
      return { kind: 'unknown', reason: `mutating flag ${arg}` }
    }
  }
  if (program === 'find') {
    const mutating = args.some(arg => ['-delete', '-exec', '-execdir', '-ok', '-okdir'].includes(arg))
    return mutating
      ? { kind: 'unknown', reason: 'find with a mutating action' }
      : { kind: 'read-only', reason: 'find without a mutating action' }
  }
  if (program === 'sort') {
    const writes = args.some(arg => arg === '-o' || arg === '--output')
    return writes
      ? { kind: 'unknown', reason: 'sort writes with -o/--output' }
      : { kind: 'read-only', reason: 'sort without an output file' }
  }
  if (program === 'uniq') {
    const positional = args.filter(arg => !arg.startsWith('-'))
    return positional.length > 1
      ? { kind: 'unknown', reason: 'uniq with an output file' }
      : { kind: 'read-only', reason: 'uniq to stdout' }
  }
  if (program === 'date') {
    const sets = args.some(arg => arg === '-s' || arg === '--set')
    return sets
      ? { kind: 'unknown', reason: 'date with --set' }
      : { kind: 'read-only', reason: 'date read form' }
  }
  if (READ_ONLY_COMMANDS.has(program)) {
    return { kind: 'read-only', reason: `${program} is a read-only command` }
  }
  const subcommands = SUBCOMMAND_READ_ONLY[program]
  if (subcommands !== undefined) {
    if (program === 'git') return classifyGit(args)
    if (program === 'gh') return classifyGh(args)
    const sub = args.find(arg => !arg.startsWith('-'))
    if (sub === undefined) {
      return { kind: 'unknown', reason: `${program} without a subcommand` }
    }
    if (subcommands.has(sub)) {
      return { kind: 'read-only', reason: `${program} ${sub} is read-only` }
    }
    return { kind: 'unknown', reason: `${program} ${sub} is not in the read-only list` }
  }
  return { kind: 'unknown', reason: `${program} is not a known read-only command` }
}
