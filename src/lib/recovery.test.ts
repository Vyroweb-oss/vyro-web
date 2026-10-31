import { describe, it, expect } from 'vitest'
import { DRAFT_KEY, validateDraft, saveDraft, loadDraft, clearDraft, detectRecovery, acceptDraft, type DraftRecord } from './recovery'
import { createSnapshot } from './versions'

function fakeStorage(initial?: Record<string, string>) {
  const m = new Map<string, string>(Object.entries(initial ?? {}))
  return {
    map: m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v) },
    removeItem: (k: string) => { m.delete(k) },
  }
}

const docA = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})
const savedDoc = (text: string, title = 'Doc') => ({ id: 'd1', title, content: docA(text) })
const draft = (text: string, title = 'Doc'): DraftRecord => ({
  docId: 'd1', content: docA(text), title, savedAt: '2026-01-02T00:00:00.000Z',
})

describe('recovery', () => {
  it('identical draft = no recovery offered', () => {
    expect(detectRecovery(savedDoc('hello'), draft('hello'))).toBeNull()
    expect(detectRecovery(savedDoc('hello'), null)).toBeNull()
  })
  it('different content = recovery offered with lengths and excerpts', () => {
    const info = detectRecovery(savedDoc('hello world'), draft('hello brave new world'))
    expect(info).not.toBeNull()
    expect(info!.savedLength).toBe('hello world'.length)
    expect(info!.draftLength).toBe('hello brave new world'.length)
    expect(info!.draftExcerpt).toContain('brave')
    expect(info!.savedExcerpt).toContain('world')
  })
  it('title-only difference = NO recovery (release-hardening policy, 2026-10-31: a title is not lost content — the false banner users hit)', () => {
    expect(detectRecovery(savedDoc('same', 'Old'), draft('same', 'New'))).toBeNull()
  })
  it('corrupt draft = rejected, never offered', () => {
    expect(detectRecovery(savedDoc('hello'), { docId: 'd1', content: { type: 'paragraph' }, title: 'Doc', savedAt: '2026-01-02T00:00:00.000Z' } as any)).toBeNull()
    expect(detectRecovery(savedDoc('hello'), { docId: 'd2', content: docA('other'), title: 'Doc', savedAt: '2026-01-02T00:00:00.000Z' })).toBeNull()
    expect(validateDraft(null)).toBeNull()
    expect(validateDraft({ docId: 'd1', content: docA('x'), title: 'T', savedAt: 'bogus' })).toBeNull()
  })
  it('draft save/load round-trip; corrupt store loads empty and is not overwritten by read', () => {
    const store = fakeStorage()
    expect(saveDraft(store as any, draft('unsaved work'))).toBe(true)
    expect(loadDraft(store as any, 'd1')?.content.content[0].content[0].text).toBe('unsaved work')
    expect(loadDraft(store as any, 'other')).toBeNull()
    const corrupt = '{bad json'
    const bad = fakeStorage({ [DRAFT_KEY]: corrupt })
    expect(loadDraft(bad as any, 'd1')).toBeNull()
    expect(bad.map.get(DRAFT_KEY)).toBe(corrupt)
  })
  it('storage-full draft save returns false and preserves prior draft', () => {
    const store = fakeStorage()
    saveDraft(store as any, draft('first'))
    const prior = store.map.get(DRAFT_KEY)!
    const failing = { getItem: store.getItem, setItem: () => { throw new Error('QuotaExceededError') } }
    expect(saveDraft(failing as any, draft('second'))).toBe(false)
    expect(store.map.get(DRAFT_KEY)).toBe(prior)
  })
  it('clearDraft removes only that doc and never throws', () => {
    const store = fakeStorage()
    saveDraft(store as any, draft('a'))
    saveDraft(store as any, { docId: 'd2', content: docA('b'), title: 'T', savedAt: '2026-01-02T00:00:00.000Z' })
    expect(clearDraft(store as any, 'd1')).toBe(true)
    expect(loadDraft(store as any, 'd1')).toBeNull()
    expect(loadDraft(store as any, 'd2')).not.toBeNull()
    expect(clearDraft({ getItem: () => null, setItem: () => { throw new Error('x') } } as any, 'd9')).toBe(true)
  })
  it('acceptDraft snapshots the saved doc as pre-restore backup before applying the draft', () => {
    const saved = savedDoc('saved text')
    const d = draft('recovered text')
    const res = acceptDraft(saved, d, [])
    expect(res).not.toBeNull()
    expect(res!.backup.trigger).toBe('pre-restore')
    expect(JSON.stringify(res!.backup.content)).toBe(JSON.stringify(saved.content))
    expect(JSON.stringify(res!.restored.content)).toBe(JSON.stringify(d.content))
    expect(res!.versions.length).toBe(1)
    // A corrupt or foreign draft is never accepted.
    expect(acceptDraft(saved, { ...d, docId: 'd2' }, [])).toBeNull()
    expect(acceptDraft(saved, { ...d, content: null } as any, [])).toBeNull()
  })
  it('FA/RTL draft round-trips byte-identical', () => {
    const faText = 'متن بازیابی‌نشدهٔ فارسی با ۱۲۳ و 📝'
    const store = fakeStorage()
    const d: DraftRecord = { docId: 'd-fa', content: docA(faText), title: 'سند', savedAt: '2026-01-02T00:00:00.000Z' }
    expect(saveDraft(store as any, d)).toBe(true)
    const loaded = loadDraft(store as any, 'd-fa')!
    expect(JSON.stringify(loaded.content)).toBe(JSON.stringify(d.content))
    expect(detectRecovery({ id: 'd-fa', title: 'سند', content: docA('متن قدیمی') }, loaded)).not.toBeNull()
    expect(detectRecovery({ id: 'd-fa', title: 'سند', content: docA(faText) }, loaded)).toBeNull()
  })
  it('headless crash flow: draft -> notice -> accept -> backup + draft content', () => {
    const saved = savedDoc('last saved')
    const store = fakeStorage()
    saveDraft(store as any, draft('work before crash'))
    const info = detectRecovery(saved, loadDraft(store as any, 'd1'))
    expect(info).not.toBeNull()
    const existing = [createSnapshot(saved, 'manual', 'Before crash')!]
    const res = acceptDraft(saved, info!.draft, existing)!
    expect(res.versions.length).toBe(2) // existing + pre-restore backup
    expect(res.versions.some((v) => v.trigger === 'pre-restore')).toBe(true)
    expect(clearDraft(store as any, 'd1')).toBe(true)
    expect(loadDraft(store as any, 'd1')).toBeNull()
  })
})


describe('detectRecovery freshness + canonical policy (release hardening, 2026-10-31)', () => {
  const T = (h: number) => `2026-01-02T0${h}:00:00.000Z`
  const savedAt = (text: string, updatedAt: string, title = 'Doc') => ({ id: 'd1', title, content: docA(text), updatedAt })
  const draftAt = (text: string, savedAt: string, title = 'Doc'): DraftRecord => ({ docId: 'd1', content: docA(text), title, savedAt })

  it('identical draft (same content, saved after the doc) = no banner', () => {
    expect(detectRecovery(savedAt('hello', T(1)), draftAt('hello', T(3)))).toBeNull()
  })
  it('identical content with different JSON key order = no banner (canonical compare)', () => {
    const a = { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'left', x: 1 }, content: [{ type: 'text', text: 'hi' }] }] }
    const b = { content: [{ content: [{ text: 'hi', type: 'text' }], attrs: { x: 1, textAlign: 'left' }, type: 'paragraph' }], type: 'doc' }
    expect(detectRecovery({ id: 'd1', title: 'Doc', content: a, updatedAt: T(1) }, { docId: 'd1', content: b, title: 'Doc', savedAt: T(3) })).toBeNull()
  })
  it('genuinely newer draft with different content = recovery offered', () => {
    const info = detectRecovery(savedAt('old text', T(1)), draftAt('old text plus unsaved work', T(3)))
    expect(info).not.toBeNull()
    expect(info!.draftLength).toBeGreaterThan(info!.savedLength)
  })
  it('stale draft (saved before the last confirmed save, different content) = no banner', () => {
    expect(detectRecovery(savedAt('newer saved text', T(5)), draftAt('older draft text', T(2)))).toBeNull()
  })
  it('tie timestamp with different content = recovery offered (never silently dropped)', () => {
    expect(detectRecovery(savedAt('saved text', T(3)), draftAt('saved text!', T(3)))).not.toBeNull()
  })
  it('refresh/reopen simulation: the live false-banner scenario (renamed doc, flushed save) stays silent', () => {
    // Worker flow that produced the false banner live: edits autosaved
    // (draft written at T3 with the pre-rename title), the flush landed at
    // T4 under the new title; on reopen the draft must NOT raise a banner.
    const store = fakeStorage()
    saveDraft(store as any, { docId: 'd1', content: docA('verify text'), title: 'Untitled document', savedAt: T(3) })
    const loaded = loadDraft(store as any, 'd1')
    const savedDocNow = { id: 'd1', title: 'LIVE VERIFY TEST', content: docA('verify text'), updatedAt: T(4) }
    expect(detectRecovery(savedDocNow, loaded)).toBeNull()
  })
  it('refresh/reopen simulation: a genuinely unsaved newer draft still raises recovery', () => {
    const store = fakeStorage()
    saveDraft(store as any, { docId: 'd1', content: docA('work not yet saved'), title: 'Doc', savedAt: T(6) })
    const loaded = loadDraft(store as any, 'd1')
    const savedDocNow = { id: 'd1', title: 'Doc', content: docA('older saved'), updatedAt: T(4) }
    expect(detectRecovery(savedDocNow, loaded)).not.toBeNull()
  })
})
