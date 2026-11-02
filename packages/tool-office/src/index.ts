/**
 * `create_document` — generate a simple Word, Excel, or PDF document.
 *
 * This is the deterministic core the Office skills can build on: headings,
 * paragraphs, bullets, and tables, written inside the session working
 * directory. It does not attempt styling fidelity; rich formatting belongs to
 * a skill that owns the document model.
 *
 * @module @zcd/tool-office
 */

import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { dirname, extname, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx'
import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'
import type {} from '@zcd/deferred-tools'

export const name = 'zcd-tool-office'
export const inject = ['tools', 'deferredTools']

/** One content block. */
interface Block {
  kind: 'heading' | 'paragraph' | 'bullet' | 'table'
  text?: string
  level?: number
  rows?: string[][]
}

const blockSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true, enum: ['heading', 'paragraph', 'bullet', 'table'] },
    text: { type: 'string' },
    level: { type: 'integer' },
    rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
  },
} as const

/** Resolve a path inside the session cwd. */
function inside(cwd: string, input: string): string {
  const absolute = resolve(cwd, input)
  if (absolute !== cwd && !absolute.startsWith(cwd + sep)) {
    throw new Error('document path escapes the session working directory')
  }
  return absolute
}

/** Ensure the requested extension matches the format. */
function withExtension(path: string, format: 'docx' | 'xlsx' | 'pdf'): string {
  return extname(path).toLowerCase() === `.${format}` ? path : `${path}.${format}`
}

/** Build a docx buffer. */
export async function buildDocx(title: string | undefined, blocks: readonly Block[]): Promise<Buffer> {
  const children: (Paragraph | Table)[] = []
  if (title !== undefined && title.length > 0) {
    children.push(new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }))
  }
  for (const block of blocks) {
    if (block.kind === 'heading') {
      children.push(new Paragraph({ text: block.text ?? '', heading: HeadingLevel.HEADING_2 }))
    } else if (block.kind === 'bullet') {
      children.push(new Paragraph({ text: block.text ?? '', bullet: { level: 0 } }))
    } else if (block.kind === 'table') {
      const rows = block.rows ?? []
      if (rows.length === 0) continue
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: rows.map(row => new TableRow({
          children: row.map(cell => new TableCell({ children: [new Paragraph({ children: [new TextRun(cell)] })] })),
        })),
      }))
    } else {
      children.push(new Paragraph({ text: block.text ?? '' }))
    }
  }
  const document = new Document({ sections: [{ children }] })
  return Packer.toBuffer(document)
}

/** Build an xlsx buffer. */
export async function buildXlsx(title: string | undefined, blocks: readonly Block[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(title?.slice(0, 31) || 'Sheet1')
  if (title !== undefined && title.length > 0) sheet.addRow([title])
  for (const block of blocks) {
    if (block.kind === 'table') {
      for (const row of block.rows ?? []) sheet.addRow(row)
    } else if (block.kind === 'heading') {
      const row = sheet.addRow([block.text ?? ''])
      row.font = { bold: true }
    } else {
      sheet.addRow([block.kind === 'bullet' ? `• ${block.text ?? ''}` : block.text ?? ''])
    }
  }
  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

/** Build a PDF buffer. */
export function buildPdf(title: string | undefined, blocks: readonly Block[]): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const doc = new PDFDocument({ margin: 56 })
    const chunks: Buffer[] = []
    doc.on('data', chunk => chunks.push(Buffer.from(chunk)))
    doc.on('end', () => resolvePromise(Buffer.concat(chunks)))
    doc.on('error', reject)
    if (title !== undefined && title.length > 0) doc.fontSize(20).text(title).moveDown(0.8)
    for (const block of blocks) {
      if (block.kind === 'heading') doc.fontSize(14).text(block.text ?? '').moveDown(0.4)
      else if (block.kind === 'bullet') doc.fontSize(11).text(`• ${block.text ?? ''}`)
      else if (block.kind === 'table') {
        for (const row of block.rows ?? []) doc.fontSize(10).text(row.join(' | '))
        doc.moveDown(0.4)
      } else doc.fontSize(11).text(block.text ?? '').moveDown(0.3)
    }
    doc.end()
  })
}

/**
 * Register `create_document`.
 * @param ctx - context carrying tools and the deferred seam.
 */
export function apply(ctx: Context): void {
  const off = ctx.deferredTools.register(defineTool({
    name: 'create_document',
    description:
      'Create a Word (.docx), Excel (.xlsx), or PDF document in the workspace from headings, '
      + 'paragraphs, bullets, and tables. Refuses to overwrite unless overwrite is true. '
      + 'For rich formatting or Office-specific features, load the matching skill.',
    parameters: {
      path: { type: 'string', required: true, description: 'Output path; the format extension is enforced.' },
      format: { type: 'string', required: true, enum: ['docx', 'xlsx', 'pdf'] },
      title: { type: 'string', description: 'Document title.' },
      blocks: {
        type: 'array',
        description: 'Content blocks in order.',
        items: blockSchema,
      },
      overwrite: { type: 'boolean', description: 'Replace an existing file (default false).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          format: { type: 'string', required: true, enum: ['docx', 'xlsx', 'pdf'] },
          bytes: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Created ${value.path} (${value.format}, ${value.bytes} bytes).`,
      }],
    },
    async execute(args, exec) {
      const cwd = exec.agent?.session.header.cwd
      if (cwd === undefined) throw new Error('create_document requires a session working directory')
      const format = args.format
      const path = inside(cwd, withExtension(args.path, format))
      if (existsSync(path) && args.overwrite !== true) {
        throw new Error(`document ${path} already exists; pass overwrite=true to replace it`)
      }
      const blocks = (args.blocks ?? []) as Block[]
      const buffer = format === 'docx'
        ? await buildDocx(args.title, blocks)
        : format === 'xlsx'
          ? await buildXlsx(args.title, blocks)
          : await buildPdf(args.title, blocks)
      mkdirSync(dirname(path), { recursive: true })
      await new Promise<void>((resolveWrite, reject) => {
        const stream = createWriteStream(path)
        stream.on('finish', () => resolveWrite())
        stream.on('error', reject)
        stream.end(buffer)
      })
      return { path, format, bytes: buffer.length }
    },
  }), { group: 'documents', keywords: ['create', 'docx', 'xlsx', 'pdf', 'office', 'write'] })

  ctx.effect(() => off, 'zcd-tool-office: deferred registration')
}
