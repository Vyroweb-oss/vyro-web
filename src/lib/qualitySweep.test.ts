// M2-17 (§22 Developer Quality Tools) — cross-feature regression sweep.
//
// TESTS ONLY: no app behaviour, document content, store format or UI is
// changed by anything in this file. Each test below was checked against
// the existing suites first and covers a gap those suites leave open:
//  - the docs-store round-trip test only checked a title, never rich JSON;
//  - versions and compare were tested in isolation, never chained
//    (snapshot -> edit -> diff, or snapshot via the version store);
//  - store backward-compat tests covered only a missing deletedAt, not a
//    legacy doc missing (or carrying invalid values for) the other
//    optional fields;
//  - link marks, export previews, stats and find were tested on simple
//    fixtures, never on one shared rich document end to end.
// No new i18n keys, no browser dialogs, no network, no real storage:
// every storage test uses an in-memory Map-backed fake.

import { describe, it, expect } from 'vitest'
import {
  createDoc, renameDoc, duplicateDoc, trashDoc, restoreDoc,
  saveDocs, loadDocs, filterDocs, STORAGE_KEY,
} from './store'
import {
  createSnapshot, addVersion, saveVersions, loadVersions, restoreVersion,
} from './versions'
import { compareDocs, renderComparisonReport } from './compare'
import { collectLinks } from './links'
import { buildExportPreview, buildArchivePayload } from './exportPresets'
import { computeDocumentStats } from './stats'
import { detectDirFromText } from './dir'
import { findMatches } from './findReplace'
import { jsonToPlainText } from './docx'

// ZWNJ (U+200C) inside «می‌خواهم» is deliberate: it must survive every
// round-trip as one joined word, never split into «می خواهم».
const ZWNJ = '‌'
const richContent = (): any => ({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'گزارش ماهانه' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: `می${ZWNJ}خواهم ` },
        { type: 'text', text: 'گزارش', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
        { type: 'text', text: ' Hello report' },
      ],
    },
    {
      type: 'table',
      content: [{
        type: 'tableRow',
        content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'سلول یک' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell two' }] }] },
        ],
      }],
    },
    { type: 'image', attrs: { src: 'data:image/png;base64,iVBORw0KGgo=', alt: 'نمودار', width: '50%' } },
  ],
})

function fakeStorage() {
  const m = new Map<string, string>()
  return {
    m,
    fake: {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => { m.set(k, v) },
    } as any,
  }
}

function richDoc() {
  const { docs, doc } = createDoc([], { title: 'Rich', dir: 'rtl', folder: 'Work', content: richContent() })
  return { docs, doc }
}

describe('quality sweep: rich-document store round-trip', () => {
  it('saves and loads a heading + FA ZWNJ/mixed paragraph + table + image + link mark deep-equal', () => {
    const { m, fake } = fakeStorage()
    const { docs } = richDoc()
    expect(saveDocs(fake, docs)).toBe(true)
    expect(m.has(STORAGE_KEY)).toBe(true)
    const back = loadDocs(fake)
    expect(back).toHaveLength(1)
    expect(back[0].content).toEqual(richContent())
    expect(back[0].dir).toBe('rtl')
    expect(back[0].folder).toBe('Work')
  })

  it('mutating the loaded copy never touches the saved payload (a fresh load is pristine)', () => {
    const { fake } = fakeStorage()
    const { docs } = richDoc()
    saveDocs(fake, docs)
    const loaded = loadDocs(fake)
    // Corrupt the in-memory copy every way a caller could.
    loaded[0].content.content[1].content[0].text = 'CHANGED'
    loaded[0].content.content[2].content[0].content[0].content[0].content[0].text = 'CHANGED'
    loaded[0].content.content[3].attrs.alt = 'CHANGED'
    const again = loadDocs(fake)
    expect(again[0].content).toEqual(richContent())
  })

  it('duplicating a rich doc deep-copies table cells and link marks (editing the copy is isolated)', () => {
    const { docs, doc } = richDoc()
    const duped = duplicateDoc(docs, doc.id)
    expect(duped).toHaveLength(2)
    const copy = duped[0]
    expect(copy.content).toEqual(richContent())
    copy.content.content[2].content[0].content[0].content[0].content[0].text = 'EDITED'
    copy.content.content[1].content[1].marks[0].attrs.href = 'https://other.example'
    expect(docs[0].content).toEqual(richContent())
  })

  it('renaming a rich doc changes only the title; content, dir and folder survive', () => {
    const { docs, doc } = richDoc()
    const renamed = renameDoc(docs, doc.id, 'Renamed')
    expect(renamed[0].title).toBe('Renamed')
    expect(renamed[0].content).toEqual(richContent())
    expect(renamed[0].dir).toBe('rtl')
    expect(renamed[0].folder).toBe('Work')
  })

  it('trash then restore preserves the full rich content', () => {
    const { docs, doc } = richDoc()
    const restored = restoreDoc(trashDoc(docs, doc.id), doc.id)
    expect(restored[0].deletedAt).toBeUndefined()
    expect(restored[0].content).toEqual(richContent())
  })
})

describe('quality sweep: versions + compare interplay', () => {
  function editedContent(): any {
    const c = richContent()
    // Change only the trailing text of the mixed paragraph.
    c.content[1].content[2].text = ' Hello updated'
    return c
  }

  it('snapshot -> edit -> compare reports the real changed line, not just names/dates', () => {
    const { doc } = richDoc()
    const snap = createSnapshot(doc, 'manual', 'Before edit')!
    expect(snap).not.toBeNull()
    const diff = compareDocs(snap.content, editedContent())
    expect(diff.summary.changed).toBeGreaterThanOrEqual(1)
    expect(diff.summary.diffHunks).toBeGreaterThanOrEqual(1)
    const changed = diff.hunks.find((h) => h.type === 'changed')!
    expect(changed).toBeDefined()
    expect(changed.aLines.map((l) => l.text).join(' ')).toContain('Hello report')
    expect(changed.bLines.map((l) => l.text).join(' ')).toContain('Hello updated')
    // The untouched heading stays an unchanged line.
    expect(diff.hunks.some((h) => h.type === 'unchanged' && h.aLines.some((l) => l.text === 'گزارش ماهانه'))).toBe(true)
  })

  it('snapshot -> append -> compare reports an added line and the report names it', () => {
    const { doc } = richDoc()
    const snap = createSnapshot(doc, 'manual')!
    const grown = richContent()
    grown.content.push({ type: 'paragraph', content: [{ type: 'text', text: 'بند تازه' }] })
    const diff = compareDocs(snap.content, grown)
    expect(diff.summary.added).toBeGreaterThanOrEqual(1)
    expect(renderComparisonReport('before', 'after', diff)).toContain('بند تازه')
  })

  it('a snapshot that travelled through the version store still diffs against the edited doc', () => {
    const { m, fake } = fakeStorage()
    const { doc } = richDoc()
    const snap = createSnapshot(doc, 'manual')!
    expect(saveVersions(fake, addVersion([], snap))).toBe(true)
    expect(m.size).toBe(1)
    const loaded = loadVersions(fake)
    expect(loaded).toHaveLength(1)
    expect(loaded[0].content).toEqual(richContent())
    const diff = compareDocs(loaded[0].content, editedContent())
    expect(diff.summary.changed).toBeGreaterThanOrEqual(1)
    expect(diff.hunks.find((h) => h.type === 'changed')!.bLines[0].text).toContain('Hello updated')
  })

  it('restoring a snapshot yields content identical to the snapshot (zero diff) and different from the edit', () => {
    const { doc } = richDoc()
    const snap = createSnapshot(doc, 'manual')!
    const edited = { id: doc.id, title: doc.title, content: editedContent() }
    const res = restoreVersion([snap], edited, snap.id)!
    expect(res).not.toBeNull()
    expect(res.restored.content).toEqual(richContent())
    expect(compareDocs(res.restored.content, snap.content).summary.diffHunks).toBe(0)
    expect(compareDocs(res.restored.content, editedContent()).summary.diffHunks).toBeGreaterThan(0)
    expect(res.backup.trigger).toBe('pre-restore')
  })
})

describe('quality sweep: legacy stored docs', () => {
  it('a doc missing every newer optional field loads as a live doc with safe defaults', () => {
    const { fake } = fakeStorage()
    fake.setItem(STORAGE_KEY, JSON.stringify([
      { id: 'legacy1', title: 'Old', content: { type: 'doc', content: [] } },
    ]))
    const back = loadDocs(fake)
    expect(back).toHaveLength(1)
    expect(back[0].folder).toBe('')
    expect(back[0].favorite).toBe(false)
    expect(back[0].dir).toBe('ltr')
    expect(back[0].margins).toBe('normal')
    expect(back[0].orientation).toBe('portrait')
    expect(back[0].templateId).toBeUndefined()
    expect(back[0].html).toBeUndefined()
    expect(back[0].deletedAt).toBeUndefined()
    expect(typeof back[0].createdAt).toBe('string')
    expect(typeof back[0].updatedAt).toBe('string')
    // And it behaves as a live doc in the dashboard lists.
    expect(filterDocs(back, {})).toHaveLength(1)
  })

  it('invalid stored margins/orientation/dir values are repaired, not trusted', () => {
    const { fake } = fakeStorage()
    fake.setItem(STORAGE_KEY, JSON.stringify([
      {
        id: 'legacy2', title: 'Old', content: { type: 'doc', content: [] },
        margins: 'huge', orientation: 'sideways', dir: 'up',
        createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-02T00:00:00.000Z',
      },
    ]))
    const back = loadDocs(fake)
    expect(back).toHaveLength(1)
    expect(back[0].margins).toBe('normal')
    expect(back[0].orientation).toBe('portrait')
    expect(back[0].dir).toBe('ltr')
  })
})

describe('quality sweep: one rich doc across links / export / stats / find / dir', () => {
  it('the link mark survives the store round-trip and is still collected afterwards', () => {
    const { fake } = fakeStorage()
    const { docs } = richDoc()
    saveDocs(fake, docs)
    const back = loadDocs(fake)
    const links = collectLinks(back[0].content)
    expect(links).toHaveLength(1)
    expect(links[0].href).toBe('https://example.com')
    expect(links[0].text).toBe('گزارش')
    expect(links[0].valid).toBe(true)
  })

  it('export preview counts the rich structure (heading, paragraphs incl. cells, table, image, link)', () => {
    const preview = buildExportPreview(richContent(), 'editable-html')
    expect(preview.structure).toEqual({ paragraphs: 3, headings: 1, tables: 1, images: 1, links: 1 })
    expect(preview.textPreview).toContain(`می${ZWNJ}خواهم`)
    expect(preview.textPreview).toContain('گزارش')
    expect(preview.archiveNote).toBe(false)
  })

  it('archive payload round-trips title, direction and the full rich content', () => {
    const payload = JSON.parse(buildArchivePayload('Rich', 'rtl', richContent()))
    expect(payload.format).toBe('vyro-web-archive-v1')
    expect(payload.title).toBe('Rich')
    expect(payload.dir).toBe('rtl')
    expect(typeof payload.exportedAt).toBe('string')
    expect(payload.content).toEqual(richContent())
  })

  it('stats on the rich doc count the ZWNJ word once, the table words once each, and the image', () => {
    const s = computeDocumentStats(richContent())
    // Heading 2 + mixed paragraph 4 + table cells 2 + 2 = 10 words.
    expect(s.words).toBe(10)
    expect(s.paragraphs).toBe(2)
    expect(s.headingsTotal).toBe(1)
    expect(s.headingsByLevel.h1).toBe(1)
    expect(s.tables).toBe(1)
    expect(s.images).toBe(1)
    expect(s.readingTimeMinutes).toBe(1)
    expect(s.estimatedPages).toBe(1)
  })

  it('find on the rich doc plain text matches the ZWNJ-joined word and not the spaced spelling', () => {
    const plain = jsonToPlainText(richContent())
    expect(plain).toContain(`می${ZWNJ}خواهم`)
    expect(findMatches(plain, `می${ZWNJ}خواهم`)).toHaveLength(1)
    expect(findMatches(plain, 'می خواهم')).toHaveLength(0)
    expect(findMatches(plain, 'Cell two')).toHaveLength(1)
  })

  it('direction detection: mixed text containing any FA script detects rtl, EN-only detects ltr', () => {
    expect(detectDirFromText('Hello world')).toBe('ltr')
    expect(detectDirFromText(`Hello می${ZWNJ}خواهم`)).toBe('rtl')
    expect(detectDirFromText('گزارش ماهانه Hello')).toBe('rtl')
  })
})
