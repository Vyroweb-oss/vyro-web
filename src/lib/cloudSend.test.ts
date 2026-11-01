import { describe, it, expect } from 'vitest'
import { planSendToCloud, classifyLinkVerification, verifyLinkHash, type SendContext } from './cloudSend'
import { contentHashOf, payloadHashOf, type SyncOp } from './syncProtocol'
import { sanitizeDoc } from './store'
import type { VyroDoc } from './types'

function mkDoc(raw: Record<string, unknown> = {}): VyroDoc {
  const doc = sanitizeDoc({
    id: 'd1', title: 'Doc',
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }] },
    folder: '', favorite: false, dir: 'ltr',
    createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-02T09:30:00.000Z',
    ...raw,
  })
  if (!doc) throw new Error('fixture failed sanitizeDoc')
  return doc
}

const CONSENT = '2026-11-01T16:00:00.000Z'
function ctx(partial: Partial<SendContext> = {}): SendContext {
  return {
    engineActive: true,
    consentAt: CONSENT,
    accountId: 'acct-1',
    queue: [],
    nowIso: '2026-11-01T17:00:00.000Z',
    ...partial,
  }
}

describe('planSendToCloud — the per-document opt-in guards', () => {
  it('happy path: exactly one insert op for exactly this document', () => {
    const doc = mkDoc()
    const plan = planSendToCloud(doc, ctx())
    if (plan.action !== 'enqueue') throw new Error('expected enqueue')
    expect(plan.op).toEqual({
      accountId: 'acct-1',
      docId: 'd1',
      op: 'insert',
      baseRevision: 0,
      payloadHash: payloadHashOf(doc),
      queuedAt: '2026-11-01T17:00:00.000Z',
    })
  })

  it('blocked when the cloud engine is inactive (signed out / free / flag off)', () => {
    expect(planSendToCloud(mkDoc(), ctx({ engineActive: false })))
      .toEqual({ action: 'blocked', reason: 'inactive' })
  })

  it('blocked without the account consent — nothing uploads before consent', () => {
    expect(planSendToCloud(mkDoc(), ctx({ consentAt: null })))
      .toEqual({ action: 'blocked', reason: 'no-consent' })
  })

  it('blocked for an already-linked document (no duplicate send)', () => {
    expect(planSendToCloud(mkDoc({ cloudRevision: 4, cloudHash: 'h' }), ctx()))
      .toEqual({ action: 'blocked', reason: 'already-linked' })
  })

  it('blocked for a conflicted document (it has its own resolution flow)', () => {
    expect(planSendToCloud(mkDoc({ cloudConflict: '2026-11-01T00:00:00.000Z' }), ctx()))
      .toEqual({ action: 'blocked', reason: 'conflicted' })
  })

  it('blocked for a trashed document', () => {
    expect(planSendToCloud(mkDoc({ deletedAt: '2026-10-20T10:00:00.000Z' }), ctx()))
      .toEqual({ action: 'blocked', reason: 'trashed' })
  })

  it('blocked when an insert for the same document is already queued (duplicate request)', () => {
    const queued: SyncOp = {
      accountId: 'acct-1', docId: 'd1', op: 'insert',
      baseRevision: 0, payloadHash: 'x', queuedAt: '2026-11-01T16:59:00.000Z',
    }
    expect(planSendToCloud(mkDoc(), ctx({ queue: [queued] })))
      .toEqual({ action: 'blocked', reason: 'already-queued' })
  })

  it("another account's queued insert does not block this account", () => {
    const other: SyncOp = {
      accountId: 'acct-2', docId: 'd1', op: 'insert',
      baseRevision: 0, payloadHash: 'x', queuedAt: '2026-11-01T16:59:00.000Z',
    }
    expect(planSendToCloud(mkDoc(), ctx({ queue: [other] })).action).toBe('enqueue')
  })

  it('a queued UPDATE for the document does not block its first send decision', () => {
    const upd: SyncOp = {
      accountId: 'acct-1', docId: 'd1', op: 'update',
      baseRevision: 0, payloadHash: 'x', queuedAt: '2026-11-01T16:59:00.000Z',
    }
    // An unlinked doc should never have an update queued; the planner only
    // treats a queued INSERT as a duplicate send request.
    expect(planSendToCloud(mkDoc(), ctx({ queue: [upd] })).action).toBe('enqueue')
  })
})

describe('classifyLinkVerification — hash read-back after a send', () => {
  it('identical hashes verify', () => {
    expect(classifyLinkVerification('abc123', 'abc123')).toBe('verified')
  })

  it('different hashes are a mismatch, never smoothed over', () => {
    expect(classifyLinkVerification('abc123', 'def456')).toBe('mismatch')
  })

  it('no server row is missing', () => {
    expect(classifyLinkVerification(null, 'abc123')).toBe('missing')
    expect(classifyLinkVerification(undefined, 'abc123')).toBe('missing')
  })
})

describe('verifyLinkHash — the column holds the CONTENT hash (engine pairing)', () => {
  it('verifies when the server stored this document’s content hash', () => {
    const doc = mkDoc()
    expect(verifyLinkHash(contentHashOf(doc.content), doc)).toBe('verified')
  })

  it('the full-payload hash is NOT what the column holds (false-alarm pairing, live 2D rehearsal)', () => {
    const doc = mkDoc()
    // payloadHashOf(doc) differs from contentHashOf(doc.content) for every
    // real document; comparing the column against it reported synced
    // documents as mismatched. Pin the semantics so it cannot regress.
    expect(payloadHashOf(doc)).not.toBe(contentHashOf(doc.content))
    expect(verifyLinkHash(payloadHashOf(doc), doc)).toBe('mismatch')
  })

  it('a genuinely different server content is a real mismatch', () => {
    const doc = mkDoc()
    const other = mkDoc({
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Changed' }] }] },
    })
    expect(verifyLinkHash(contentHashOf(other.content), doc)).toBe('mismatch')
  })

  it('no server row is missing', () => {
    expect(verifyLinkHash(null, mkDoc())).toBe('missing')
  })
})
