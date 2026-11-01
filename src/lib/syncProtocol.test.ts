import { describe, it, expect } from 'vitest'
import {
  contentHashOf, payloadHashOf, docToPayload, rowToDoc,
  collapseOps, removeMatchingOp, opsForAccount, pendingOpsFor,
  backoffDelayMs, classifyUpdateAck, classifyZeroRowUpdate,
  classifyInsertConflict, deriveDocSyncStatus, planPullMerge,
  type SyncOp, type CloudDocRow,
} from './syncProtocol'
import type { VyroDoc } from './types'

const content = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

function doc(partial: Partial<VyroDoc> = {}): VyroDoc {
  return {
    id: 'd1', title: 'Title', content: content('hello'), folder: '', favorite: false,
    dir: 'ltr', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
    ...partial,
  }
}

function op(partial: Partial<SyncOp> = {}): SyncOp {
  return {
    accountId: 'acc1', docId: 'd1', op: 'update', baseRevision: 1,
    payloadHash: 'h1', queuedAt: '2026-01-01T00:00:00.000Z', ...partial,
  }
}

describe('hashing', () => {
  it('contentHashOf is key-order independent (canonical compare) and content-sensitive', () => {
    const a = { type: 'doc', content: [{ type: 'paragraph', attrs: { x: 1, y: 2 } }] }
    const b = { content: [{ attrs: { y: 2, x: 1 }, type: 'paragraph' }], type: 'doc' }
    expect(contentHashOf(a)).toBe(contentHashOf(b))
    expect(contentHashOf(content('hello'))).not.toBe(contentHashOf(content('bye')))
    expect(contentHashOf(null)).toBe(contentHashOf(null))
  })
  it('payloadHashOf covers metadata; contentHashOf does not', () => {
    const d1 = doc()
    const d2 = doc({ title: 'Other title' })
    expect(contentHashOf(d1.content)).toBe(contentHashOf(d2.content))
    expect(payloadHashOf(d1)).not.toBe(payloadHashOf(d2))
    expect(payloadHashOf(doc({ favorite: true }))).not.toBe(payloadHashOf(d1))
    expect(payloadHashOf(doc({ deletedAt: '2026-01-03T00:00:00.000Z' }))).not.toBe(payloadHashOf(d1))
  })
})

describe('row mapping', () => {
  it('docToPayload maps the schema columns and never emits owner_id or revision', () => {
    const p = docToPayload(doc({
      html: '<p>hello</p>', folder: 'Work', favorite: true, dir: 'rtl', templateId: 'tpl1',
      margins: 'wide', orientation: 'landscape', pageSize: 'a5', pageW: 148, pageH: 210,
      customMargins: { top: 1, right: 2, bottom: 3, left: 4 }, headerText: 'H', footerText: 'F',
      deletedAt: '2026-01-04T00:00:00.000Z',
    }))
    expect(p).toEqual({
      id: 'd1', title: 'Title', content: content('hello'), html: '<p>hello</p>',
      folder: 'Work', favorite: true, dir: 'rtl', template_id: 'tpl1',
      margins: 'wide', orientation: 'landscape', page_size: 'a5', page_w: 148, page_h: 210,
      custom_margins: { top: 1, right: 2, bottom: 3, left: 4 }, header_text: 'H', footer_text: 'F',
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z',
      deleted_at: '2026-01-04T00:00:00.000Z', content_hash: contentHashOf(content('hello')),
    })
    expect(p as any).not.toHaveProperty('owner_id')
    expect(p as any).not.toHaveProperty('revision')
    expect(p as any).not.toHaveProperty('server_updated_at')
  })
  it('docToPayload nulls absent optionals', () => {
    const p = docToPayload(doc())
    expect(p.html).toBeNull(); expect(p.template_id).toBeNull(); expect(p.deleted_at).toBeNull()
    expect(p.custom_margins).toBeNull(); expect(p.page_w).toBeNull()
  })
  it('rowToDoc round-trips a fully populated row and stamps the cloud link', () => {
    const payload = docToPayload(doc({
      html: '<p>hello</p>', folder: 'Work', favorite: true, templateId: 'tpl1',
      margins: 'wide', orientation: 'landscape', pageSize: 'a5', pageW: 148, pageH: 210,
      customMargins: { top: 1, right: 2, bottom: 3, left: 4 }, headerText: 'H', footerText: 'F',
    }))
    const row: CloudDocRow = { ...payload, revision: 7, server_updated_at: '2026-01-05T00:00:00.000Z' }
    const back = rowToDoc(row)
    expect(back.cloudRevision).toBe(7)
    expect(back.cloudSyncedAt).toBe('2026-01-05T00:00:00.000Z')
    expect(back.cloudHash).toBe(payloadHashOf(back))
    expect(docToPayload(back)).toEqual(payload)
  })
})

describe('op collapsing', () => {
  it('insert absorbs a later update (still one insert, newest hash)', () => {
    const q = collapseOps([op({ op: 'insert', baseRevision: 0 })], op({ op: 'update', payloadHash: 'h2', queuedAt: '2026-01-01T01:00:00.000Z' }))
    expect(q).toHaveLength(1)
    expect(q[0]).toMatchObject({ op: 'insert', baseRevision: 0, payloadHash: 'h2' })
  })
  it('insert followed by delete cancels both', () => {
    expect(collapseOps([op({ op: 'insert', baseRevision: 0 })], op({ op: 'delete' }))).toEqual([])
  })
  it('update + update keeps the EARLIEST base and the newest hash', () => {
    const q = collapseOps([op({ baseRevision: 3, payloadHash: 'h1' })], op({ baseRevision: 4, payloadHash: 'h2' }))
    expect(q).toHaveLength(1)
    expect(q[0]).toMatchObject({ op: 'update', baseRevision: 3, payloadHash: 'h2' })
  })
  it('update then delete becomes one delete on the update base', () => {
    const q = collapseOps([op({ baseRevision: 5 })], op({ op: 'delete', baseRevision: 6 }))
    expect(q).toMatchObject([{ op: 'delete', baseRevision: 5 }])
  })
  it('delete then insert keeps BOTH, in order', () => {
    const q = collapseOps([op({ op: 'delete', baseRevision: 2 })], op({ op: 'insert', baseRevision: 0 }))
    expect(q.map((o) => o.op)).toEqual(['delete', 'insert'])
  })
  it('an update after a pending insert-of-recreate folds into that insert', () => {
    const start = collapseOps([op({ op: 'delete', baseRevision: 2 })], op({ op: 'insert', baseRevision: 0 }))
    const q = collapseOps(start, op({ op: 'update', payloadHash: 'h9' }))
    expect(q.map((o) => o.op)).toEqual(['delete', 'insert'])
    expect(q[1].payloadHash).toBe('h9')
  })
  it('never collapses across accounts or documents, and keeps queue position', () => {
    const start = [op({ docId: 'other', payloadHash: 'hx' }), op({})]
    const q = collapseOps(start, op({ accountId: 'acc2' }))
    expect(q).toHaveLength(3)
    const q2 = collapseOps(start, op({ payloadHash: 'h2' }))
    expect(q2).toHaveLength(2)
    expect(q2[0].payloadHash).toBe('hx') // untouched op keeps its slot
    expect(q2[1].payloadHash).toBe('h2')
  })
  it('does not mutate the input queue', () => {
    const start = [op({})]
    collapseOps(start, op({ payloadHash: 'h2' }))
    expect(start[0].payloadHash).toBe('h1')
  })
})

describe('queue helpers', () => {
  it('removeMatchingOp matches account/doc/op/base — queuedAt may have been rewritten by a fold', () => {
    const a = op({ queuedAt: '2026-01-01T00:00:00.000Z' })
    const b = op({ docId: 'd2', queuedAt: '2026-01-01T02:00:00.000Z' })
    // Same identity as `a` but a later queuedAt (an edit folded mid-flight):
    expect(removeMatchingOp([a, b], op({ queuedAt: '2026-01-01T03:00:00.000Z' }))).toEqual([b])
    // A different op-kind or base is a different op:
    expect(removeMatchingOp([a, b], op({ op: 'delete' }))).toEqual([a, b])
    expect(removeMatchingOp([a, b], op({ baseRevision: 9 }))).toEqual([a, b])
  })
  it('opsForAccount / pendingOpsFor filter and preserve FIFO order', () => {
    const q = [op({ docId: 'd2' }), op({ accountId: 'acc2' }), op({})]
    expect(opsForAccount(q, 'acc1').map((o) => o.docId)).toEqual(['d2', 'd1'])
    expect(pendingOpsFor(q, 'acc1', 'd1')).toHaveLength(1)
    expect(pendingOpsFor(q, 'acc2', 'd1')).toHaveLength(1)
  })
})

describe('backoff', () => {
  it('starts at ~1s, doubles, and caps at 30s (mid-jitter)', () => {
    const mid = () => 0.5
    expect(backoffDelayMs(0, mid)).toBe(1000)
    expect(backoffDelayMs(1, mid)).toBe(2000)
    expect(backoffDelayMs(2, mid)).toBe(4000)
    expect(backoffDelayMs(5, mid)).toBe(30000)
    expect(backoffDelayMs(20, mid)).toBe(30000)
    expect(backoffDelayMs(-3, mid)).toBe(1000)
  })
  it('jitter stays within ±20%', () => {
    expect(backoffDelayMs(0, () => 0)).toBe(800)
    expect(backoffDelayMs(0, () => 1)).toBe(1200)
    expect(backoffDelayMs(3, () => 0)).toBe(6400)
  })
})

describe('ack / conflict classification', () => {
  it('classifyUpdateAck: exactly base+1 is the ack; zero rows is stale', () => {
    expect(classifyUpdateAck([4], 3)).toEqual({ kind: 'synced', newRevision: 4 })
    expect(classifyUpdateAck([], 3)).toEqual({ kind: 'stale' })
    expect(classifyUpdateAck([3], 3)).toEqual({ kind: 'stale' })
    expect(classifyUpdateAck([9], 3)).toEqual({ kind: 'synced', newRevision: 9 })
  })
  it('classifyZeroRowUpdate distinguishes conflict from the premium write-block', () => {
    expect(classifyZeroRowUpdate(null, 3)).toBe('conflict') // server copy gone
    expect(classifyZeroRowUpdate(5, 3)).toBe('conflict')    // another writer won
    expect(classifyZeroRowUpdate(3, 3)).toBe('rejected')    // row unmoved, yet refused
  })
  it('classifyInsertConflict adopts only an identical payload', () => {
    expect(classifyInsertConflict('same', 'same')).toBe('adopt')
    expect(classifyInsertConflict('other', 'same')).toBe('conflict')
    expect(classifyInsertConflict(null, 'same')).toBe('conflict')
  })
})

describe('status derivation', () => {
  const base = { linked: false, dirty: false, pendingOps: 0, inFlight: false, failed: false, conflicted: false }
  it('covers the whole matrix in priority order', () => {
    expect(deriveDocSyncStatus({ ...base, conflicted: true, pendingOps: 2 })).toBe('conflict')
    expect(deriveDocSyncStatus({ ...base, inFlight: true, pendingOps: 1 })).toBe('syncing')
    expect(deriveDocSyncStatus({ ...base, pendingOps: 1, failed: true })).toBe('failed')
    expect(deriveDocSyncStatus({ ...base, pendingOps: 1 })).toBe('queued')
    expect(deriveDocSyncStatus(base)).toBe('local-only')
    expect(deriveDocSyncStatus({ ...base, linked: true })).toBe('synced')
    expect(deriveDocSyncStatus({ ...base, linked: true, dirty: true })).toBe('queued')
    expect(deriveDocSyncStatus({ ...base, linked: true, failed: true })).toBe('synced')
  })
})

describe('pull-merge planning', () => {
  const meta = (id: string, revision: number, hash: string, deleted_at: string | null = null) => ({
    ...docToPayload(doc({ id })), id, revision, content_hash: hash, deleted_at,
    server_updated_at: '2026-01-06T00:00:00.000Z',
  })
  it('adopts a server-only document', () => {
    expect(planPullMerge([], [meta('srv1', 1, 'x')])).toEqual([{ kind: 'adopt', docId: 'srv1' }])
  })
  it('ignores a doc at the acked revision, and one the server is behind on', () => {
    const local = doc({ cloudRevision: 3, cloudHash: 'stale' })
    // dirty or not, same revision = nothing to pull
    expect(planPullMerge([local], [meta('d1', 3, contentHashOf(local.content))])).toEqual([{ kind: 'ignore', docId: 'd1' }])
    expect(planPullMerge([local], [meta('d1', 2, contentHashOf(local.content))])).toEqual([{ kind: 'ignore', docId: 'd1' }])
  })
  it('updates a CLEAN local doc when the server is newer', () => {
    const clean = doc()
    const linked = { ...clean, cloudRevision: 1, cloudHash: payloadHashOf(clean) }
    expect(planPullMerge([linked], [meta('d1', 2, 'otherhash')])).toEqual([{ kind: 'update-local', docId: 'd1' }])
  })
  it('never overwrites a DIRTY local doc: newer server = conflict', () => {
    const clean = doc()
    const dirty = { ...clean, cloudRevision: 1, cloudHash: payloadHashOf(clean), title: 'Local edit' }
    expect(planPullMerge([dirty], [meta('d1', 2, 'otherhash')])).toEqual([{ kind: 'conflict', docId: 'd1' }])
  })
  it('links a never-linked doc whose content already matches the server', () => {
    const local = doc()
    expect(planPullMerge([local], [meta('d1', 1, contentHashOf(local.content))]))
      .toEqual([{ kind: 'link', docId: 'd1', revision: 1 }])
  })
  it('a never-linked doc with DIFFERENT content is a conflict, never an overwrite', () => {
    const local = doc()
    expect(planPullMerge([local], [meta('d1', 1, 'different')])).toEqual([{ kind: 'conflict', docId: 'd1' }])
  })
  it('leaves conflicted docs and local-only docs alone', () => {
    const conflicted = doc({ cloudRevision: 1, cloudConflict: '2026-01-03T00:00:00.000Z' })
    expect(planPullMerge([conflicted], [meta('d1', 9, 'x')])).toEqual([{ kind: 'ignore', docId: 'd1' }])
    expect(planPullMerge([doc({ id: 'mine' })], [])).toEqual([])
  })
})
