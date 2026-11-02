import { describe, expect, it } from 'vitest'
import { assertNoSecrets, parseEntry, renderEntry, slugify } from '../src/index.js'

describe('slugify', () => {
  it('normalizes names to filesystem-safe ids', () => {
    expect(slugify('Use pnpm, not npm!')).toBe('use-pnpm-not-npm')
    expect(slugify('  ')).toBe('entry')
  })
})

describe('parseEntry / renderEntry', () => {
  it('round-trips an entry', () => {
    const entry = {
      id: 'x',
      scope: 'project' as const,
      name: 'Build command',
      description: 'Use pnpm build',
      type: 'fact' as const,
      body: 'Run `pnpm build` before pushing.',
      updatedAt: 123,
    }
    expect(parseEntry('project', 'x', renderEntry(entry))).toEqual(entry)
  })

  it('rejects malformed frontmatter', () => {
    expect(parseEntry('project', 'x', 'no frontmatter')).toBeUndefined()
    expect(parseEntry('project', 'x', '---\nname: x\n---\nbody')).toBeUndefined()
  })
})

describe('assertNoSecrets', () => {
  it('rejects common credential shapes', () => {
    expect(() => assertNoSecrets('sk-abcdefghijklmnopqrstuvwx')).toThrow(/credential/)
    expect(() => assertNoSecrets('AKIAABCDEFGHIJKLMNOP')).toThrow(/credential/)
    expect(() => assertNoSecrets('-----BEGIN RSA PRIVATE KEY-----')).toThrow(/credential/)
  })

  it('allows ordinary text', () => {
    expect(() => assertNoSecrets('The build command is pnpm build.')).not.toThrow()
  })
})
