import { jsonToPlainText } from './docText'
import type { I18nKey } from './i18n'

// Export Presets (Mission 2, M2-14 = owner spec §16). Pure, unit-testable,
// no DOM. Every preset states honestly what it keeps and what it drops:
// no preset claims fidelity it cannot keep. In particular:
// - print-ready produces NO file: it opens the browser print dialog, and
//   a PDF only exists if the user chooses "Save as PDF" there.
// - archive holds the full document JSON but is NOT re-importable through
//   the app's import UI (import accepts TXT and DOCX only).
export type ExportPresetId = 'print-ready' | 'editable-html' | 'plain-text' | 'archive'

export type ExportAction = 'print' | 'html' | 'text' | 'archive'

export interface ExportPresetDef {
  id: ExportPresetId
  /** File extension for presets that produce a file; null for print. */
  ext: string | null
  action: ExportAction
  labelKey: I18nKey
  descKey: I18nKey
  keeps: I18nKey[]
  drops: I18nKey[]
}

export const EXPORT_PRESET_IDS: ExportPresetId[] = ['print-ready', 'editable-html', 'plain-text', 'archive']

export const EXPORT_PRESETS: Record<ExportPresetId, ExportPresetDef> = {
  'print-ready': {
    id: 'print-ready',
    ext: null,
    action: 'print',
    labelKey: 'exportPresetPrintReady',
    descKey: 'exportPresetPrintReadyDesc',
    keeps: ['exportKeepText', 'exportKeepHeadings', 'exportKeepLists', 'exportKeepTables', 'exportKeepLayout'],
    drops: ['exportDropChrome'],
  },
  'editable-html': {
    id: 'editable-html',
    ext: 'html',
    action: 'html',
    labelKey: 'exportPresetEditableHtml',
    descKey: 'exportPresetEditableHtmlDesc',
    keeps: ['exportKeepText', 'exportKeepHeadings', 'exportKeepLists', 'exportKeepLinks', 'exportKeepTables', 'exportKeepImages'],
    drops: ['exportDropWordStyling'],
  },
  'plain-text': {
    id: 'plain-text',
    ext: 'txt',
    action: 'text',
    labelKey: 'exportPresetPlainText',
    descKey: 'exportPresetPlainTextDesc',
    keeps: ['exportKeepText', 'exportKeepParagraphBreaks'],
    drops: ['exportDropFormatting', 'exportDropImages', 'exportDropTableStructure', 'exportDropLinks'],
  },
  archive: {
    id: 'archive',
    ext: 'json',
    action: 'archive',
    labelKey: 'exportPresetArchive',
    descKey: 'exportPresetArchiveDesc',
    keeps: ['exportKeepFullDoc'],
    drops: ['exportDropArchiveImport'],
  },
}

/** Strip filename-illegal characters and control chars, collapse
 *  whitespace, cap at 100 chars; fall back to 'document' when empty. */
export function sanitizeFilename(base: string): string {
  const cleaned = String(base ?? '')
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 100)
    .trim()
  return cleaned || 'document'
}

function localDateSuffix(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** base + optional '-YYYY-MM-DD' (LOCAL date parts, never toISOString,
 *  so the suffix matches the user's calendar day) + '.' + ext. */
export function buildExportFilename(
  base: string,
  ext: string,
  opts?: { dateSuffix?: boolean; date?: Date },
): string {
  const safe = sanitizeFilename(base)
  const suffix = opts?.dateSuffix ? `-${localDateSuffix(opts.date ?? new Date())}` : ''
  return `${safe}${suffix}.${ext}`
}

export interface ExportStructure {
  paragraphs: number
  headings: number
  tables: number
  images: number
  links: number
}

export interface ExportPreview {
  /** First 500 chars of plain text; '' for the archive preset. */
  textPreview: string
  structure: ExportStructure
  /** True only for the archive preset (preview is structure-only). */
  archiveNote: boolean
}

function countStructure(json: any): ExportStructure {
  const s: ExportStructure = { paragraphs: 0, headings: 0, tables: 0, images: 0, links: 0 }
  const rec = (n: any) => {
    if (!n || typeof n !== 'object') return
    if (n.type === 'paragraph') s.paragraphs++
    else if (n.type === 'heading') s.headings++
    else if (n.type === 'table') s.tables++
    else if (n.type === 'image') s.images++
    if (n.type === 'text' && Array.isArray(n.marks) && n.marks.some((m: any) => m?.type === 'link')) s.links++
    if (Array.isArray(n.content)) n.content.forEach(rec)
  }
  rec(json)
  return s
}

/** Preview for one preset over the current editor JSON. Paragraph nodes
 *  inside table cells count as paragraphs (they are paragraphs). */
export function buildExportPreview(json: any, preset: ExportPresetId): ExportPreview {
  const archiveNote = preset === 'archive'
  const textPreview = archiveNote ? '' : jsonToPlainText(json).slice(0, 500)
  return { textPreview, structure: countStructure(json), archiveNote }
}

export interface ArchivePayload {
  format: 'vyro-web-archive-v1'
  title: string
  dir: string
  exportedAt: string
  content: any
}

/** The archive file body: the full document JSON plus its title and
 *  direction, stamped with an ISO export time. */
export function buildArchivePayload(title: string, dir: string, json: any): string {
  const payload: ArchivePayload = {
    format: 'vyro-web-archive-v1',
    title: title || 'document',
    dir,
    exportedAt: new Date().toISOString(),
    content: json,
  }
  return JSON.stringify(payload, null, 2)
}
