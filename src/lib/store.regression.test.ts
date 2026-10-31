import { describe, it, expect } from 'vitest'
import { createDoc, duplicateDoc, searchDocs, loadDocs, saveDocs, sanitizeDoc, normalizeSearchText, STORAGE_KEY, CORRUPT_BACKUP_KEY } from './store'
import { escapeHtml, isSafeLinkUrl } from './docx'

function fakeStorage(initial: Record<string, string> = {}) {
  const m = new Map<string, string>(Object.entries(initial))
  return { map: m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } }
}

describe('store hardening regressions (round 2)', () => {
  it('corrupt JSON: returns [] and preserves payload under backup key', () => {
    const s = fakeStorage({ [STORAGE_KEY]: '{not json' })
    expect(loadDocs(s as any)).toEqual([])
    expect(s.map.get(CORRUPT_BACKUP_KEY)).toBe('{not json')
  })
  it('non-array JSON: treated as corrupt, backed up', () => {
    const s = fakeStorage({ [STORAGE_KEY]: '{"a":1}' })
    expect(loadDocs(s as any)).toEqual([])
    expect(s.map.get(CORRUPT_BACKUP_KEY)).toBe('{"a":1}')
  })
  it('malformed entries are dropped, valid ones repaired — one bad record cannot crash the library', () => {
    const good = createDoc([], { title: 'Good' }).doc
    const raw = JSON.stringify([good, { id: 'x' }, { title: 'no id', content: {} }, null, 42, { id: 'y', content: { type: 'doc' } }])
    const s = fakeStorage({ [STORAGE_KEY]: raw })
    const docs = loadDocs(s as any)
    expect(docs.map(d => d.id)).toEqual([good.id, 'y'])
    expect(docs[1].title).toBe('Untitled'); expect(docs[1].dir).toBe('ltr'); expect(docs[1].margins).toBe('normal')
  })
  it('saveDocs never throws on quota errors and reports failure', () => {
    const throwing = { setItem: () => { throw new Error('QuotaExceededError') } }
    let out: boolean | undefined
    expect(() => { out = saveDocs(throwing as any, []) }).not.toThrow()
    expect(out).toBe(false)
  })
  it('duplicate deep-copies content (mutating the copy cannot touch the original)', () => {
    const { docs, doc } = createDoc([], { title: 'Orig', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] } })
    const dup = duplicateDoc(docs, doc.id)
    const copy = dup[0]
    copy.content.content[0].content[0].text = 'CHANGED'
    const origAfter = dup.find(d => d.id === doc.id)!
    expect(origAfter.content.content[0].content[0].text).toBe('hi')
    expect(copy.id).not.toBe(doc.id)
  })
  it('search matches Persian titles typed with Arabic keyboard variants', () => {
    const { docs } = createDoc([], { title: 'گزارش کاری' }) // Persian ی / ک
    expect(normalizeSearchText('كاري')).toBe(normalizeSearchText('کاری'))
    expect(searchDocs(docs, 'كاري')).toHaveLength(1) // Arabic ك + ي
    expect(searchDocs(docs, 'گزارش')).toHaveLength(1)
    expect(searchDocs(docs, 'ناموجود')).toHaveLength(0)
  })
  it('sanitizeDoc rejects unsafe shapes', () => {
    expect(sanitizeDoc(null)).toBeNull(); expect(sanitizeDoc({})).toBeNull()
    expect(sanitizeDoc({ id: 'a', content: 'string-content' })).toBeNull()
  })
})

describe('html/link safety helpers', () => {
  it('escapeHtml neutralises title injection', () => {
    expect(escapeHtml('</title><script>alert(1)</script>')).not.toContain('<script>')
    expect(escapeHtml('a & "b"')).toBe('a &amp; &quot;b&quot;')
  })
  it('isSafeLinkUrl allows web/mail only', () => {
    expect(isSafeLinkUrl('https://example.com')).toBe(true)
    expect(isSafeLinkUrl('http://example.com')).toBe(true)
    expect(isSafeLinkUrl('mailto:a@b.com')).toBe(true)
    expect(isSafeLinkUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeLinkUrl('data:text/html,<b>x</b>')).toBe(false)
    expect(isSafeLinkUrl('vbscript:x')).toBe(false)
    expect(isSafeLinkUrl('')).toBe(false)
  })
})

describe('sanitizeDoc header/footer (release mission)', () => {
  it('carries headerText/footerText, trims and caps them, drops empty ones', () => {
    const base = { id: 'x1', title: 'T', content: { type: 'doc', content: [] }, createdAt: 'a', updatedAt: 'b' }
    const d = sanitizeDoc({ ...base, headerText: '  My Header  ', footerText: 'My Footer' })!
    expect(d.headerText).toBe('My Header')
    expect(d.footerText).toBe('My Footer')
    const empty = sanitizeDoc({ ...base, headerText: '   ', footerText: 42 })!
    expect(empty.headerText).toBeUndefined()
    expect(empty.footerText).toBeUndefined()
  })
})
