import { describe, it, expect } from 'vitest'
import {
  buildLibraryBackup,
  serializeLibraryBackup,
  parseLibraryBackup,
  restoreLibrary,
  verifyRestoredLibrary,
  LIBRARY_BACKUP_KIND,
  type LibraryState,
} from './libraryBackup'
import { sanitizeDoc } from './store'
import type { VyroDoc } from './types'
import type { VersionSnapshot } from './versions'
import type { DraftRecord } from './recovery'

// Fixtures are built through sanitizeDoc — the same normalisation every
// real library load applies — so round-trip comparisons measure the
// backup module, not fixture sloppiness.
function mkDoc(raw: Record<string, unknown>): VyroDoc {
  const doc = sanitizeDoc({
    folder: '', favorite: false, dir: 'ltr',
    createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-02T09:30:00.000Z',
    ...raw,
  })
  if (!doc) throw new Error('fixture doc failed sanitizeDoc')
  return doc
}

function para(text: string, marks?: unknown[]) {
  return {
    type: 'paragraph',
    content: text ? [{ type: 'text', text, ...(marks ? { marks } : {}) }] : undefined,
  }
}

const simpleContent = { type: 'doc', content: [para('Hello world')] }

const formattedContent = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1, textAlign: 'center' }, content: [{ type: 'text', text: 'Report' }] },
    {
      type: 'paragraph',
      attrs: { textAlign: 'left' },
      content: [
        { type: 'text', text: 'Bold', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' and ' },
        { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
        { type: 'text', text: ' and ' },
        { type: 'text', text: 'a link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
        { type: 'text', text: ' and ' },
        { type: 'text', text: 'colored', marks: [{ type: 'textStyle', attrs: { color: '#c00000' } }] },
      ],
    },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [para('First item')] },
        { type: 'listItem', content: [para('Second item')] },
      ],
    },
    {
      type: 'image',
      attrs: { src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', alt: 'dot' },
    },
  ],
}

const tableContent = {
  type: 'doc',
  content: [
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', content: [para('Name')] },
            { type: 'tableHeader', content: [para('City')] },
          ],
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [para('Najmuddin')] },
            { type: 'tableCell', content: [para('کابل')] },
          ],
        },
      ],
    },
    para('After the table'),
  ],
}

// Dari text with ZWNJ (نیم‌فاصله), Arabic-script letters and an emoji.
const dariText = 'می‌خواهم این سند را در فضای ابری نگه دارم — کابل، افغانستان 🇦🇫'
const dariContent = { type: 'doc', content: [para(dariText)] }

function mkVersion(partial: Partial<VersionSnapshot> & { id: string; docId: string }): VersionSnapshot {
  return {
    createdAt: '2026-10-01T08:05:00.000Z',
    trigger: 'manual',
    content: simpleContent,
    title: 'Doc',
    ...partial,
  }
}

function roundTrip(state: LibraryState) {
  const text = serializeLibraryBackup(buildLibraryBackup(state, new Date('2026-11-01T17:00:00.000Z')))
  const parsed = parseLibraryBackup(text)
  if (!parsed.ok) throw new Error(`parse failed: ${parsed.error}`)
  return { text, parsed: parsed.value, restored: restoreLibrary(parsed.value) }
}

describe('library backup — coverage of the library', () => {
  it('empty library round-trips with zero counts', () => {
    const state: LibraryState = { docs: [], versions: [], drafts: {} }
    const { parsed, restored } = roundTrip(state)
    expect(parsed.backup.kind).toBe(LIBRARY_BACKUP_KIND)
    expect(parsed.backup.counts).toEqual({ documents: 0, versions: 0, drafts: 0 })
    expect(restored.documents).toEqual([])
    expect(restored.versions).toEqual([])
    expect(restored.drafts).toEqual({})
    const v = verifyRestoredLibrary(state, restored)
    expect(v.documentsChecked).toBe(0)
    expect(v.mismatchedDocIds).toEqual([])
  })

  it('several documents, versions, drafts and a trashed doc all survive', () => {
    const docs = [
      mkDoc({ id: 'a', title: 'Alpha', content: simpleContent }),
      mkDoc({ id: 'b', title: 'Beta', content: formattedContent, favorite: true, folder: 'Work' }),
      mkDoc({ id: 'c', title: 'Gamma', content: tableContent, deletedAt: '2026-10-20T10:00:00.000Z' }),
    ]
    const versions = [
      mkVersion({ id: 'v1', docId: 'a', label: 'First' }),
      mkVersion({ id: 'v2', docId: 'a', trigger: 'auto', content: formattedContent }),
      mkVersion({ id: 'v3', docId: 'c', trigger: 'pre-restore' }),
    ]
    const drafts: Record<string, DraftRecord> = {
      b: { docId: 'b', content: dariContent, title: 'Beta', savedAt: '2026-10-02T09:31:00.000Z' },
    }
    const state: LibraryState = { docs, versions, drafts }
    const { parsed, restored } = roundTrip(state)
    expect(parsed.droppedDocuments).toBe(0)
    expect(parsed.droppedVersions).toBe(0)
    expect(parsed.droppedDrafts).toBe(0)
    expect(restored.documents.map((d) => d.id)).toEqual(['a', 'b', 'c'])
    expect(restored.documents.find((d) => d.id === 'c')?.deletedAt).toBe('2026-10-20T10:00:00.000Z')
    const v = verifyRestoredLibrary(state, restored)
    expect(v.documentsIdentical).toBe(3)
    expect(v.versionsIdentical).toBe(3)
    expect(v.draftsIdentical).toBe(1)
    expect(v.mismatchedDocIds).toEqual([])
    expect(v.mismatchedVersionIds).toEqual([])
    expect(v.mismatchedDraftIds).toEqual([])
  })
})

describe('library backup — content fidelity', () => {
  it('text and formatting (marks, heading, list, link, colour, image) are identical after restore', () => {
    const state: LibraryState = {
      docs: [mkDoc({ id: 'f', title: 'Formatted', content: formattedContent })],
      versions: [],
      drafts: {},
    }
    const { restored } = roundTrip(state)
    expect(JSON.stringify(restored.documents[0].content)).toBe(JSON.stringify(formattedContent))
    const v = verifyRestoredLibrary(state, restored)
    expect(v.documentsIdentical).toBe(1)
  })

  it('tables survive cell-for-cell', () => {
    const state: LibraryState = {
      docs: [mkDoc({ id: 't', title: 'Table', content: tableContent })],
      versions: [],
      drafts: {},
    }
    const { restored } = roundTrip(state)
    expect(JSON.stringify(restored.documents[0].content)).toBe(JSON.stringify(tableContent))
  })

  it('non-English text (Dari with ZWNJ, emoji) is byte-identical after restore', () => {
    const state: LibraryState = {
      docs: [mkDoc({ id: 'fa', title: 'سند دری', content: dariContent, dir: 'rtl' })],
      versions: [],
      drafts: {},
    }
    const { restored } = roundTrip(state)
    const textNode = (restored.documents[0].content as any).content[0].content[0]
    expect(textNode.text).toBe(dariText)
    expect(restored.documents[0].dir).toBe('rtl')
  })
})

describe('library backup — cloud links stay outside the documents', () => {
  it('linked doc: fields stripped into the manifest, restored doc is local-only, content still verifies', () => {
    const linked = mkDoc({
      id: 'cl', title: 'Linked', content: simpleContent,
      cloudRevision: 7, cloudHash: 'hash-abc', cloudSyncedAt: '2026-11-01T10:00:00.000Z',
    })
    const state: LibraryState = { docs: [linked], versions: [], drafts: {} }
    const backup = buildLibraryBackup(state)
    expect(backup.documents[0].cloudRevision).toBeUndefined()
    expect(backup.documents[0].cloudHash).toBeUndefined()
    expect(backup.cloudLinks).toEqual([
      { docId: 'cl', cloudRevision: 7, cloudHash: 'hash-abc', cloudSyncedAt: '2026-11-01T10:00:00.000Z' },
    ])
    const { restored } = roundTrip(state)
    expect(restored.documents[0].cloudRevision).toBeUndefined()
    expect(restored.cloudLinks).toHaveLength(1)
    const v = verifyRestoredLibrary(state, restored)
    expect(v.documentsIdentical).toBe(1)
  })

  it('building a backup never mutates the input library', () => {
    const state: LibraryState = {
      docs: [mkDoc({ id: 'm', title: 'Mine', content: formattedContent, cloudRevision: 3, cloudHash: 'h' })],
      versions: [mkVersion({ id: 'vm', docId: 'm' })],
      drafts: { m: { docId: 'm', content: simpleContent, title: 'Mine', savedAt: '2026-10-02T00:00:00.000Z' } },
    }
    const before = JSON.stringify(state)
    buildLibraryBackup(state)
    expect(JSON.stringify(state)).toBe(before)
  })
})

describe('library backup — corrupt, incomplete and interrupted files', () => {
  const state: LibraryState = {
    docs: [mkDoc({ id: 'x', title: 'X', content: simpleContent })],
    versions: [mkVersion({ id: 'vx', docId: 'x' })],
    drafts: {},
  }
  const goodText = serializeLibraryBackup(buildLibraryBackup(state))

  it('a non-JSON file is rejected as not-json', () => {
    expect(parseLibraryBackup('this is not a backup {{{')).toEqual({ ok: false, error: 'not-json' })
  })

  it('an interrupted (truncated) write is rejected, never partially restored', () => {
    const half = goodText.slice(0, Math.floor(goodText.length / 2))
    expect(parseLibraryBackup(half)).toEqual({ ok: false, error: 'not-json' })
    const almostAll = goodText.slice(0, goodText.length - 5)
    expect(parseLibraryBackup(almostAll)).toEqual({ ok: false, error: 'not-json' })
  })

  it('a foreign JSON file is rejected as wrong-kind', () => {
    expect(parseLibraryBackup(JSON.stringify({ kind: 'something-else', formatVersion: 1 })))
      .toEqual({ ok: false, error: 'wrong-kind' })
  })

  it('an unsupported format version is rejected', () => {
    const future = JSON.stringify({ ...JSON.parse(goodText), formatVersion: 99 })
    expect(parseLibraryBackup(future)).toEqual({ ok: false, error: 'unsupported-version' })
  })

  it('a structurally incomplete bundle (missing sections) is rejected as bad-shape', () => {
    const noVersions = JSON.parse(goodText); delete noVersions.versions
    expect(parseLibraryBackup(JSON.stringify(noVersions))).toEqual({ ok: false, error: 'bad-shape' })
    const draftsGarbage = JSON.parse(goodText); draftsGarbage.drafts = 'corrupt'
    expect(parseLibraryBackup(JSON.stringify(draftsGarbage))).toEqual({ ok: false, error: 'bad-shape' })
  })

  it('individually invalid entries are dropped and counted; healthy entries survive', () => {
    const mixed = JSON.parse(goodText)
    mixed.documents.push({ noId: true })
    mixed.documents.push({ id: 'ok2', title: 'Second', content: simpleContent })
    mixed.versions.push({ id: 'bad', docId: 'x', trigger: 'nonsense' })
    mixed.drafts = { ghost: { docId: 'other', content: simpleContent, title: 'G', savedAt: '2026-10-02T00:00:00.000Z' } }
    const parsed = parseLibraryBackup(JSON.stringify(mixed))
    if (!parsed.ok) throw new Error('expected ok')
    expect(parsed.value.droppedDocuments).toBe(1)
    expect(parsed.value.droppedVersions).toBe(1)
    expect(parsed.value.droppedDrafts).toBe(1)
    expect(parsed.value.backup.documents.map((d) => d.id)).toEqual(['x', 'ok2'])
    expect(parsed.value.backup.counts.documents).toBe(2)
  })

  it('counts written in the file are never trusted — parse recomputes them', () => {
    const lying = JSON.parse(goodText)
    lying.counts = { documents: 999, versions: 999, drafts: 999 }
    const parsed = parseLibraryBackup(JSON.stringify(lying))
    if (!parsed.ok) throw new Error('expected ok')
    expect(parsed.value.backup.counts).toEqual({ documents: 1, versions: 1, drafts: 0 })
  })
})
