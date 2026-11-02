/**
 * Document text extraction with stable location anchors.
 *
 * Anchors are the contract with a future viewer: `#l:n` for text lines,
 * `#p:n` for docx paragraphs, `#s:Sheet!A1` for spreadsheet rows, and
 * `#page:n` for PDF pages. Extraction is read-only and bounded.
 *
 * @module @zcd/tool-documents/extract
 */

import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import ExcelJS from 'exceljs'
import mammoth from 'mammoth'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

/** One addressable text unit. */
export interface DocUnit {
  readonly anchor: string
  readonly text: string
}

/** Extraction result. */
export interface DocExtract {
  readonly kind: 'text' | 'docx' | 'xlsx' | 'pdf'
  readonly units: readonly DocUnit[]
  readonly truncated: boolean
}

/** Extraction limits. */
export interface ExtractLimits {
  readonly maxUnits: number
  readonly maxChars: number
}

const DEFAULTS: ExtractLimits = { maxUnits: 2000, maxChars: 200_000 }

/**
 * Extract addressable text from one document.
 * @param path - absolute file path.
 * @param limits - unit/character caps.
 * @returns the extraction.
 */
export async function extractDocument(path: string, limits: ExtractLimits = DEFAULTS): Promise<DocExtract> {
  const extension = extname(path).toLowerCase()
  if (extension === '.docx') return extractDocx(path, limits)
  if (extension === '.xlsx' || extension === '.xlsm') return extractXlsx(path, limits)
  if (extension === '.pdf') return extractPdf(path, limits)
  return extractText(path, limits)
}

/** Bound a unit list by count and characters. */
function bound(units: DocUnit[], limits: ExtractLimits): { units: DocUnit[]; truncated: boolean } {
  const out: DocUnit[] = []
  let chars = 0
  let truncated = false
  for (const unit of units) {
    if (out.length >= limits.maxUnits || chars + unit.text.length > limits.maxChars) {
      truncated = true
      break
    }
    out.push(unit)
    chars += unit.text.length
  }
  return { units: out, truncated }
}

/** Text and Markdown by line. */
async function extractText(path: string, limits: ExtractLimits): Promise<DocExtract> {
  const text = await readFile(path, 'utf8')
  const units = text.split(/\r?\n/).map((line, index) => ({ anchor: `#l:${index + 1}`, text: line }))
  return { kind: 'text', ...bound(units, limits) }
}

/** Word paragraphs. */
async function extractDocx(path: string, limits: ExtractLimits): Promise<DocExtract> {
  const result = await mammoth.extractRawText({ path })
  const units = result.value
    .split(/\n+/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map((line, index) => ({ anchor: `#p:${index + 1}`, text: line }))
  return { kind: 'docx', ...bound(units, limits) }
}

/** Spreadsheet rows, one unit per non-empty row. */
async function extractXlsx(path: string, limits: ExtractLimits): Promise<DocExtract> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(path)
  const units: DocUnit[] = []
  workbook.eachSheet(sheet => {
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells: string[] = []
      row.eachCell({ includeEmpty: false }, cell => {
        const value = cell.value
        const text = value === null || value === undefined
          ? ''
          : typeof value === 'object' && 'text' in value
            ? String((value as { text: unknown }).text)
            : String(value)
        if (text.length > 0) cells.push(text)
      })
      if (cells.length > 0) {
        units.push({ anchor: `#s:${sheet.name}!A${rowNumber}`, text: cells.join(' | ') })
      }
    })
  })
  return { kind: 'xlsx', ...bound(units, limits) }
}

/** PDF pages, one unit per page. */
async function extractPdf(path: string, limits: ExtractLimits): Promise<DocExtract> {
  const data = new Uint8Array(await readFile(path))
  const task = getDocument({ data, useWorkerFetch: false })
  const pdf = await task.promise
  const units: DocUnit[] = []
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      const text = content.items
        .map(item => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (text.length > 0) units.push({ anchor: `#page:${pageNumber}`, text })
    }
  } finally {
    await pdf.destroy()
  }
  return { kind: 'pdf', ...bound(units, limits) }
}
