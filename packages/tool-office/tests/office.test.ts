import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import mammoth from 'mammoth'
import { describe, expect, it } from 'vitest'
import { buildDocx, buildPdf, buildXlsx } from '../src/index.js'

const blocks = [
  { kind: 'heading' as const, text: 'Summary' },
  { kind: 'paragraph' as const, text: 'Hello document.' },
  { kind: 'bullet' as const, text: 'First point' },
  { kind: 'table' as const, rows: [['A', 'B'], ['1', '2']] },
]

describe('create_document builders', () => {
  it('builds a docx that mammoth can read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcd-office-'))
    const file = join(dir, 'test.docx')
    writeFileSync(file, await buildDocx('Report', blocks))
    const text = (await mammoth.extractRawText({ path: file })).value
    expect(text).toContain('Report')
    expect(text).toContain('Hello document.')
    expect(text).toContain('First point')
  })

  it('builds an xlsx with the title and table rows', async () => {
    const buffer = await buildXlsx('Sheet title', blocks)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer)
    const sheet = workbook.worksheets[0]
    expect(sheet?.getCell('A1').value).toBe('Sheet title')
    expect(sheet?.getCell('A5').value).toBe('A')
  })

  it('builds a PDF buffer', async () => {
    const buffer = await buildPdf('PDF title', blocks)
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
    expect(buffer.length).toBeGreaterThan(500)
  })
})
