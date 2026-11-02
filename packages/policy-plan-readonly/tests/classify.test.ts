import { describe, expect, it } from 'vitest'
import { classifyCommand, splitWords } from '../src/classify.js'

describe('splitWords', () => {
  it('honours quotes', () => {
    expect(splitWords('grep "a b" file')).toEqual(['grep', 'a b', 'file'])
  })

  it('rejects unbalanced quotes', () => {
    expect(splitWords('grep "unterminated')).toBeUndefined()
  })
})

describe('classifyCommand', () => {
  it.each([
    ['ls -la'],
    ['pwd'],
    ['cat README.md'],
    ['head -n 20 file.txt'],
    ['rg "TODO" packages'],
    ['git status'],
    ['git log --oneline -5'],
    ['git diff HEAD~1'],
    ['git branch --list'],
    ['git remote -v'],
    ['git config --get user.name'],
    ['gh pr view 12'],
    ['find . -name "*.ts"'],
    ['sort file.txt'],
    ['uniq file.txt'],
    ['date'],
  ])('classifies %s as read-only', (command) => {
    expect(classifyCommand(command).kind).toBe('read-only')
  })

  it.each([
    ['rm -rf build'],
    ['echo hi > out.txt'],
    ['echo hi >> out.txt'],
    ['cat a | grep b'],
    ['git commit -m "x"'],
    ['git branch -d old'],
    ['git tag v1'],
    ['git config user.name x'],
    ['find . -delete'],
    ['find . -exec rm {} ;'],
    ['sort -o out.txt in.txt'],
    ['uniq in.txt out.txt'],
    ['date -s "2026-01-01"'],
    ['sed -i s/a/b/ file'],
    ['FOO=bar ls'],
    ['python -c "print(1)"'],
    [''],
  ])('refuses to call %s read-only', (command) => {
    expect(classifyCommand(command).kind).toBe('unknown')
  })
})
