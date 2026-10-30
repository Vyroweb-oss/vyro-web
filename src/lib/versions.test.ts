import { describe, it, expect } from 'vitest'
import {
  VERSIONS_KEY, DEFAULT_MAX_COUNT, createSnapshot, listVersions, pruneVersions,
  addVersion, validateSnapshot, saveVersions, loadVersions, restoreVersion,
  snapshotToPlainText, snapshotByteSize, type VersionSnapshot,
} from './versions'

function fakeStorage(initial?: Record<string, string>) {
  const m = new Map<string, string>(Object.entries(initial ?? {}))
  return {
    map: m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v) },
  }
}

const docA = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})
const doc = (id: string, title: string, text: string) => ({ id, title, content: docA(text) })
const snap = (docId: string, at: string, trigger: any = 'auto', label?: string): VersionSnapshot => ({
  id: `v-${docId}-${at}-${label ?? trigger}-${Math.random().toString(36).slice(2, 6)}`,
  docId, createdAt: at, label, trigger, content: docA(`text ${at}`), title: 'T',
})

describe('versions', () => {
  it('createSnapshot deep-copies: later edits never mutate the snapshot', () => {
    const d = doc('d1', 'Doc', 'hello')
    const s = createSnapshot(d, 'manual', 'My name')
    expect(s).not.toBeNull()
    d.content.content[0].content[0].text = 'MUTATED'
    expect(JSON.stringify(s!.content)).toContain('hello')
    expect(JSON.stringify(s!.content)).not.toContain('MUTATED')
    expect(s!.label).toBe('My name')
    expect(s!.trigger).toBe('manual')
  })
  it('createSnapshot rejects non-doc content', () => {
    expect(createSnapshot({ id: 'd1', title: 'T', content: { type: 'paragraph' } }, 'manual')).toBeNull()
    expect(createSnapshot({ id: 'd1', title: 'T', content: null }, 'manual')).toBeNull()
    expect(createSnapshot({ id: '', title: 'T', content: docA('x') }, 'manual')).toBeNull()
  })
  it('listVersions returns newest first for one doc only', () => {
    const all = [snap('d1', '2026-01-01T00:00:00.000Z'), snap('d2', '2026-01-03T00:00:00.000Z'), snap('d1', '2026-01-02T00:00:00.000Z')]
    const list = listVersions(all, 'd1')
    expect(list.map((v) => v.createdAt)).toEqual(['2026-01-02T00:00:00.000Z', '2026-01-01T00:00:00.000Z'])
  })
  it('prune count cap: default 20 per doc, oldest unlabelled first', () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      snap('d1', `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`))
    const pruned = pruneVersions(many)
    expect(pruned.length).toBe(DEFAULT_MAX_COUNT)
    expect(pruned.map((v) => v.createdAt)).not.toContain('2026-01-01T00:00:00.000Z')
    expect(pruned.map((v) => v.createdAt)).toContain('2026-01-25T00:00:00.000Z')
  })
  it('prune protects named snapshots even past the count cap', () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      snap('d1', `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`))
    const named = snap('d1', '2026-01-01T00:00:00.000Z', 'manual', 'Keep me')
    const pruned = pruneVersions([...many, named], { maxCount: 5 })
    expect(pruned.find((v) => v.id === named.id)).toBeDefined()
    expect(pruned.filter((v) => !v.label).length).toBeLessThanOrEqual(5)
  })
  it('prune byte cap drops oldest unlabelled first and keeps named', () => {
    const big = (at: string, label?: string): VersionSnapshot => ({
      ...snap('d1', at, 'auto', label), content: docA('x'.repeat(500)),
    })
    const all = [big('2026-01-01T00:00:00.000Z'), big('2026-01-02T00:00:00.000Z'), big('2026-01-03T00:00:00.000Z', 'Named')]
    const sizes = all.map(snapshotByteSize)
    const cap = sizes[2] + sizes[1] // only room for the two newest by bytes
    const pruned = pruneVersions(all, { maxCount: 20, maxTotalBytes: cap })
    expect(pruned.find((v) => v.createdAt === '2026-01-03T00:00:00.000Z')).toBeDefined()
    expect(pruned.find((v) => v.createdAt === '2026-01-01T00:00:00.000Z')).toBeUndefined()
  })
  it('corrupt snapshots are rejected by validateSnapshot and dropped on load', () => {
    expect(validateSnapshot({ id: 'x', docId: 'd1', createdAt: '2026-01-01T00:00:00.000Z', trigger: 'manual', content: { type: 'paragraph' }, title: 'T' })).toBeNull()
    expect(validateSnapshot({ id: 'x', docId: 'd1', createdAt: 'not-a-date', trigger: 'manual', content: docA('x'), title: 'T' })).toBeNull()
    expect(validateSnapshot(null)).toBeNull()
    const store = fakeStorage({ [VERSIONS_KEY]: JSON.stringify([snap('d1', '2026-01-01T00:00:00.000Z'), { bogus: true }, snap('d1', '2026-01-02T00:00:00.000Z')]) })
    expect(loadVersions(store as any).length).toBe(2)
  })
  it('loadVersions never throws and never overwrites corrupt data', () => {
    const corrupt = '{not json'
    const store = fakeStorage({ [VERSIONS_KEY]: corrupt })
    expect(loadVersions(store as any)).toEqual([])
    expect(store.map.get(VERSIONS_KEY)).toBe(corrupt) // untouched by the read
    expect(loadVersions({ getItem: () => { throw new Error('blocked') } } as any)).toEqual([])
  })
  it('storage-full save returns false and preserves prior data', () => {
    const good = [snap('d1', '2026-01-01T00:00:00.000Z')]
    const prior = JSON.stringify(good)
    const store = fakeStorage({ [VERSIONS_KEY]: prior })
    const failing = { getItem: store.getItem, setItem: () => { throw new Error('QuotaExceededError') } }
    expect(saveVersions(failing as any, [snap('d1', '2026-01-02T00:00:00.000Z')])).toBe(false)
    expect(store.map.get(VERSIONS_KEY)).toBe(prior)
    // Invalid payload is refused before any write, too.
    expect(saveVersions(store as any, [{ bogus: true } as any])).toBe(false)
    expect(store.map.get(VERSIONS_KEY)).toBe(prior)
  })
  it('save/load round-trip is byte-identical for FA/RTL content', () => {
    const faText = 'سلام دنیا! این یک سند فارسی است با اعداد ۱۲۳ و ایموجی 📝 و کلمات عربی ي ك ة'
    const d = doc('d-fa', 'سند فارسی', faText)
    const s = createSnapshot(d, 'manual', 'نسخهٔ فارسی')!
    const store = fakeStorage()
    expect(saveVersions(store as any, [s])).toBe(true)
    const loaded = loadVersions(store as any)
    expect(loaded.length).toBe(1)
    expect(JSON.stringify(loaded[0].content)).toBe(JSON.stringify(d.content))
    expect(loaded[0].label).toBe('نسخهٔ فارسی')
    expect(snapshotToPlainText(loaded[0].content)).toBe(faText)
  })
  it('headless restore flow: pre-restore backup first, then target content', () => {
    const current = doc('d1', 'Current', 'current text')
    const old = createSnapshot(doc('d1', 'Old title', 'old text'), 'manual', 'Before edits', '2026-01-01T00:00:00.000Z')!
    const res = restoreVersion([old], current, old.id)
    expect(res).not.toBeNull()
    expect(res!.backup.trigger).toBe('pre-restore')
    expect(JSON.stringify(res!.backup.content)).toBe(JSON.stringify(current.content))
    expect(res!.restored.title).toBe('Old title')
    expect(JSON.stringify(res!.restored.content)).toBe(JSON.stringify(doc('d1', 'Old title', 'old text').content))
    expect(res!.versions.find((v) => v.id === res!.backup.id)).toBeDefined()
    expect(res!.versions.find((v) => v.id === old.id)).toBeDefined()
  })
  it('restore returns null for unknown version or wrong doc', () => {
    const current = doc('d1', 'Current', 'current')
    const other = createSnapshot(doc('d2', 'Other', 'other'), 'manual')!
    expect(restoreVersion([other], current, other.id)).toBeNull()
    expect(restoreVersion([], current, 'missing')).toBeNull()
  })
  it('addVersion enforces caps on insert', () => {
    let store: VersionSnapshot[] = []
    for (let i = 0; i < 25; i++) {
      const s = createSnapshot(doc('d1', 'T', `v${i}`), 'auto', undefined, `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`)!
      store = addVersion(store, s)
    }
    expect(store.length).toBe(DEFAULT_MAX_COUNT)
  })
})
