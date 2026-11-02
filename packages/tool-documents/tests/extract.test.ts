import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractDocument } from '../src/extract.js'

describe('extractDocument', () => {
  it('extracts text by line with anchors', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcd-doc-'))
    const file = join(dir, 'notes.md')
    writeFileSync(file, '# Title\nfirst\nsecond\n')
    const result = await extractDocument(file)
    expect(result.kind).toBe('text')
    expect(result.units.map(unit => unit.anchor)).toEqual(['#l:1', '#l:2', '#l:3', '#l:4'])
    expect(result.units[1]?.text).toBe('first')
  })

  it('caps units', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcd-doc-'))
    const file = join(dir, 'many.txt')
    writeFileSync(file, Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n'))
    const result = await extractDocument(file, { maxUnits: 3, maxChars: 10_000 })
    expect(result.units).toHaveLength(3)
    expect(result.truncated).toBe(true)
  })
})
