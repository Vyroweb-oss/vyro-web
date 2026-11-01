import { describe, it, expect } from 'vitest'
import { sanitizeDoc, duplicateDoc } from './store'
import { isCloudDocsEnabled } from './supabaseEnv'
import type { VyroDoc } from './types'

// Stage 2B: the local doc's cloud bookkeeping must survive the store's
// sanitize-on-load (or every reload would forget the server revision and
// re-drive sync from scratch), and a duplicated doc must NOT inherit the
// original's cloud link.

const baseRaw = {
  id: 'd1', title: 'T', content: { type: 'doc', content: [{ type: 'paragraph' }] },
  folder: '', favorite: false, dir: 'ltr',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
}

describe('sanitizeDoc cloud fields', () => {
  it('carries well-formed cloud bookkeeping through a reload', () => {
    const d = sanitizeDoc({
      ...baseRaw, cloudRevision: 4, cloudHash: 'abc123',
      cloudSyncedAt: '2026-01-03T00:00:00.000Z', cloudConflict: '2026-01-04T00:00:00.000Z',
    })!
    expect(d.cloudRevision).toBe(4)
    expect(d.cloudHash).toBe('abc123')
    expect(d.cloudSyncedAt).toBe('2026-01-03T00:00:00.000Z')
    expect(d.cloudConflict).toBe('2026-01-04T00:00:00.000Z')
  })
  it('drops malformed cloud bookkeeping instead of trusting it', () => {
    const d = sanitizeDoc({
      ...baseRaw, cloudRevision: 'four' as any, cloudHash: 42 as any,
      cloudSyncedAt: '', cloudConflict: null,
    })!
    expect(d.cloudRevision).toBeUndefined()
    expect(d.cloudHash).toBeUndefined()
    expect(d.cloudSyncedAt).toBeUndefined()
    expect(d.cloudConflict).toBeUndefined()
    const zero = sanitizeDoc({ ...baseRaw, cloudRevision: 0 })!
    expect(zero.cloudRevision).toBeUndefined() // revisions start at 1
  })
  it('docs without cloud fields stay without them (byte-identical Local Mode shape)', () => {
    const d = sanitizeDoc(baseRaw)!
    expect(d.cloudRevision).toBeUndefined()
    expect(d.cloudHash).toBeUndefined()
    expect(d.cloudSyncedAt).toBeUndefined()
    expect(d.cloudConflict).toBeUndefined()
  })
})

describe('duplicateDoc cloud link', () => {
  it('a duplicate is a fresh, unlinked document', () => {
    const src: VyroDoc = {
      id: 'd1', title: 'T', content: { type: 'doc', content: [{ type: 'paragraph' }] },
      folder: '', favorite: false, dir: 'ltr',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
      cloudRevision: 9, cloudHash: 'zzz', cloudSyncedAt: '2026-01-03T00:00:00.000Z',
      cloudConflict: '2026-01-04T00:00:00.000Z',
    }
    const out = duplicateDoc([src], 'd1')
    const copy = out[0]
    expect(copy.id).not.toBe('d1')
    expect(copy.cloudRevision).toBeUndefined()
    expect(copy.cloudHash).toBeUndefined()
    expect(copy.cloudSyncedAt).toBeUndefined()
    expect(copy.cloudConflict).toBeUndefined()
    // …and the original keeps its link.
    expect(out[1].cloudRevision).toBe(9)
  })
})

describe('cloud kill switch', () => {
  it('is off unless VITE_CLOUD_DOCS_ENABLED is exactly "true" (unset in tests)', () => {
    expect(isCloudDocsEnabled).toBe(false)
  })
})
