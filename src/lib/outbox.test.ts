import { describe, it, expect } from 'vitest'
import { OUTBOX_KEY, validateOp, loadOutbox, saveOutbox, enqueueOp, pendingCountFor } from './outbox'
import type { SyncOp } from './syncProtocol'

function fakeStorage(initial?: Record<string, string>) {
  const m = new Map<string, string>(Object.entries(initial ?? {}))
  return {
    map: m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v) },
  }
}

const op = (partial: Partial<SyncOp> = {}): SyncOp => ({
  accountId: 'acc1', docId: 'd1', op: 'update', baseRevision: 1,
  payloadHash: 'h1', queuedAt: '2026-01-01T00:00:00.000Z', ...partial,
})

describe('outbox validation', () => {
  it('accepts a well-formed op and normalises baseRevision', () => {
    expect(validateOp(op({ baseRevision: 2.9 }))?.baseRevision).toBe(2)
    expect(validateOp(op())).toMatchObject({ accountId: 'acc1', docId: 'd1', op: 'update' })
  })
  it('rejects malformed entries', () => {
    expect(validateOp(null)).toBeNull()
    expect(validateOp({})).toBeNull()
    expect(validateOp(op({ accountId: '' }))).toBeNull()
    expect(validateOp(op({ docId: '' }))).toBeNull()
    expect(validateOp(op({ op: 'frobnicate' as any }))).toBeNull()
    expect(validateOp(op({ baseRevision: -1 }))).toBeNull()
    expect(validateOp(op({ baseRevision: Number.NaN }))).toBeNull()
    expect(validateOp(op({ payloadHash: '' }))).toBeNull()
    expect(validateOp(op({ queuedAt: 'not-a-date' }))).toBeNull()
  })
})

describe('outbox persistence', () => {
  it('round-trips through storage (survives a reload)', () => {
    const s = fakeStorage()
    expect(saveOutbox(s as any, [op(), op({ docId: 'd2', op: 'insert', baseRevision: 0 })])).toBe(true)
    expect(s.map.has(OUTBOX_KEY)).toBe(true)
    // A fresh load from the same storage is the reload scenario.
    expect(loadOutbox(s as any)).toEqual([op(), op({ docId: 'd2', op: 'insert', baseRevision: 0 })])
  })
  it('load never throws and never writes: corrupt payloads degrade to [] and stay untouched', () => {
    const s = fakeStorage({ [OUTBOX_KEY]: '{broken json' })
    expect(loadOutbox(s as any)).toEqual([])
    expect(s.map.get(OUTBOX_KEY)).toBe('{broken json')
    const s2 = fakeStorage({ [OUTBOX_KEY]: '{"not":"an array"}' })
    expect(loadOutbox(s2 as any)).toEqual([])
    expect(loadOutbox({ getItem: () => { throw new Error('blocked') } } as any)).toEqual([])
  })
  it('load drops individually corrupt entries and keeps the healthy ones', () => {
    const s = fakeStorage({ [OUTBOX_KEY]: JSON.stringify([op(), { bogus: true }, op({ docId: 'd2' })]) })
    expect(loadOutbox(s as any).map((o) => o.docId)).toEqual(['d1', 'd2'])
  })
  it('save refuses an invalid queue without writing anything', () => {
    const s = fakeStorage()
    expect(saveOutbox(s as any, [op(), { nope: 1 } as any])).toBe(false)
    expect(s.map.has(OUTBOX_KEY)).toBe(false)
    const throwing = { setItem: () => { throw new Error('quota') } }
    expect(saveOutbox(throwing as any, [op()])).toBe(false)
  })
})

describe('enqueueOp', () => {
  it('persists the collapsed queue: insert + update reloads as ONE insert', () => {
    const s = fakeStorage()
    let q = enqueueOp(s as any, [], op({ op: 'insert', baseRevision: 0 }))
    q = enqueueOp(s as any, q, op({ op: 'update', payloadHash: 'h2', queuedAt: '2026-01-01T01:00:00.000Z' }))
    expect(q).toHaveLength(1)
    const reloaded = loadOutbox(s as any)
    expect(reloaded).toHaveLength(1)
    expect(reloaded[0]).toMatchObject({ op: 'insert', payloadHash: 'h2' })
  })
  it('an op is still there after a reload until something acks it (no ack, no removal)', () => {
    const s = fakeStorage()
    enqueueOp(s as any, [], op())
    expect(loadOutbox(s as any)).toHaveLength(1)
    expect(loadOutbox(s as any)).toHaveLength(1) // reading never consumes
  })
  it('pendingCountFor counts only the given account', () => {
    const q = [op(), op({ accountId: 'acc2' }), op({ docId: 'd2' })]
    expect(pendingCountFor(q, 'acc1')).toBe(2)
    expect(pendingCountFor(q, 'acc2')).toBe(1)
    expect(pendingCountFor(q, 'nobody')).toBe(0)
  })
})
