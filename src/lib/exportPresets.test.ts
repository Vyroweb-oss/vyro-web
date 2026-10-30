import { describe, it, expect } from 'vitest'
import {
  EXPORT_PRESETS, EXPORT_PRESET_IDS, sanitizeFilename, buildExportFilename,
  buildExportPreview, buildArchivePayload,
} from './exportPresets'
import { STRINGS } from './i18n'

const fixture = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
    { type: 'paragraph', content: [
      { type: 'text', text: 'Hello ' },
      { type: 'text', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }], text: 'link' },
    ] },
    { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'cell' }] },
    ] }] }] },
    { type: 'image', attrs: { src: 'x.png', alt: 'pic' } },
  ],
}

describe('exportPresets sanitizeFilename', () => {
  it('strips illegal chars', () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij')
    expect(sanitizeFilename('my:doc*name?')).toBe('mydocname')
  })
  it('strips control chars, trims and collapses whitespace', () => {
    expect(sanitizeFilename('  my   \t doc\nname  ')).toBe('my doc name')
    expect(sanitizeFilename('a\u0007b')).toBe('ab')
  })
  it('falls back to document when empty', () => {
    expect(sanitizeFilename('')).toBe('document')
    expect(sanitizeFilename('   ///:::')).toBe('document')
  })
  it('caps at 100 chars', () => {
    const long = 'x'.repeat(150)
    expect(sanitizeFilename(long)).toBe('x'.repeat(100))
    expect(sanitizeFilename('y '.repeat(80)).length).toBeLessThanOrEqual(100)
  })
})

describe('exportPresets buildExportFilename', () => {
  it('without date suffix', () => {
    expect(buildExportFilename('My Doc', 'txt')).toBe('My Doc.txt')
  })
  it('with date suffix, deterministic with an injected date', () => {
    // Local Date constructor: 2026-10-30 in the caller's timezone.
    const d = new Date(2026, 9, 30, 12, 0, 0)
    expect(buildExportFilename('My Doc', 'html', { dateSuffix: true, date: d })).toBe('My Doc-2026-10-30.html')
    expect(buildExportFilename('My Doc', 'html', { dateSuffix: false, date: d })).toBe('My Doc.html')
  })
  it('sanitizes the base before adding suffix and extension', () => {
    const d = new Date(2026, 0, 5, 12, 0, 0)
    expect(buildExportFilename('a/b', 'json', { dateSuffix: true, date: d })).toBe('ab-2026-01-05.json')
    expect(buildExportFilename('', 'txt')).toBe('document.txt')
  })
})

describe('exportPresets definitions', () => {
  it('has exactly the four specified presets', () => {
    expect([...EXPORT_PRESET_IDS].sort()).toEqual(['archive', 'editable-html', 'plain-text', 'print-ready'])
    expect(Object.keys(EXPORT_PRESETS).sort()).toEqual([...EXPORT_PRESET_IDS].sort())
  })
  it('every preset has non-empty, distinct keeps and drops', () => {
    for (const id of EXPORT_PRESET_IDS) {
      const p = EXPORT_PRESETS[id]
      expect(p.keeps.length, `${id} keeps`).toBeGreaterThan(0)
      expect(p.drops.length, `${id} drops`).toBeGreaterThan(0)
      const overlap = p.keeps.filter(k => p.drops.includes(k))
      expect(overlap, `${id} keeps/drops overlap`).toEqual([])
      for (const k of [...p.keeps, ...p.drops]) {
        expect(STRINGS.en[k], `${id} key ${k} en`).toBeTruthy()
        expect(STRINGS.fa[k], `${id} key ${k} fa`).toBeTruthy()
      }
    }
  })
  it('print-ready claims no generated PDF: action is print, no file extension', () => {
    const p = EXPORT_PRESETS['print-ready']
    expect(p.action).toBe('print')
    expect(p.ext).toBeNull()
    // Its description must say the PDF comes from the browser dialog.
    expect(STRINGS.en[p.descKey]).toMatch(/print dialog/i)
    expect(STRINGS.en[p.descKey]).not.toMatch(/generates a PDF|creates a PDF/i)
  })
  it('archive is honest about not being re-importable', () => {
    const p = EXPORT_PRESETS.archive
    expect(p.ext).toBe('json')
    expect(STRINGS.en[p.descKey]).toMatch(/NOT re-importable/i)
    expect(STRINGS.en[p.drops[0]]).toMatch(/TXT\/DOCX/i)
  })
  it('other presets carry their file extensions', () => {
    expect(EXPORT_PRESETS['editable-html'].ext).toBe('html')
    expect(EXPORT_PRESETS['plain-text'].ext).toBe('txt')
  })
})

describe('exportPresets buildExportPreview', () => {
  it('counts headings, paragraphs, tables, images and links on a fixture doc', () => {
    const prev = buildExportPreview(fixture, 'plain-text')
    expect(prev.structure).toEqual({ paragraphs: 2, headings: 1, tables: 1, images: 1, links: 1 })
    expect(prev.archiveNote).toBe(false)
    expect(prev.textPreview).toContain('Title')
    expect(prev.textPreview).toContain('Hello link')
  })
  it('truncates the text preview at 500 chars', () => {
    const big = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'z'.repeat(900) }] }] }
    const prev = buildExportPreview(big, 'editable-html')
    expect(prev.textPreview.length).toBe(500)
  })
  it('archive preview carries no text sample but flags the archive note', () => {
    const prev = buildExportPreview(fixture, 'archive')
    expect(prev.textPreview).toBe('')
    expect(prev.archiveNote).toBe(true)
    expect(prev.structure.headings).toBe(1)
  })
  it('empty document previews cleanly', () => {
    const prev = buildExportPreview({ type: 'doc', content: [] }, 'plain-text')
    expect(prev.textPreview).toBe('')
    expect(prev.structure).toEqual({ paragraphs: 0, headings: 0, tables: 0, images: 0, links: 0 })
  })
})

describe('exportPresets buildArchivePayload', () => {
  it('round-trips title, direction and content', () => {
    const payload = buildArchivePayload('My Doc', 'rtl', fixture)
    const parsed = JSON.parse(payload)
    expect(parsed.format).toBe('vyro-web-archive-v1')
    expect(parsed.title).toBe('My Doc')
    expect(parsed.dir).toBe('rtl')
    expect(parsed.content).toEqual(fixture)
    expect(typeof parsed.exportedAt).toBe('string')
    expect(Number.isNaN(Date.parse(parsed.exportedAt))).toBe(false)
  })
  it('falls back to document title when empty', () => {
    expect(JSON.parse(buildArchivePayload('', 'ltr', fixture)).title).toBe('document')
  })
})

describe('exportPresets i18n keys', () => {
  it('every new key exists in both languages and fa differs from en', () => {
    const keys = [
      'exportPresets', 'exportPresetsDesc', 'exportPresetPrintReady', 'exportPresetPrintReadyDesc',
      'exportPresetEditableHtml', 'exportPresetEditableHtmlDesc', 'exportPresetPlainText', 'exportPresetPlainTextDesc',
      'exportPresetArchive', 'exportPresetArchiveDesc', 'exportKeeps', 'exportDrops', 'exportFilename',
      'exportDateSuffix', 'exportPreview', 'exportRefreshPreview', 'exportRun', 'exportPrint', 'exportSuccess',
      'exportParagraphs',
      'exportPrintStarted', 'exportFailed', 'exportNoPreview', 'exportArchiveNote',
    ] as const
    for (const k of keys) {
      expect(STRINGS.en[k], `en.${k}`).toBeTruthy()
      expect(STRINGS.fa[k], `fa.${k}`).toBeTruthy()
      expect(STRINGS.fa[k], `fa.${k} differs`).not.toBe(STRINGS.en[k])
    }
  })
})
