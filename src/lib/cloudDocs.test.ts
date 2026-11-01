import { describe, it, expect } from 'vitest'
import {
  fetchDocumentList, fetchDocument, insertDocument, updateDocument,
  deleteDocument, isPremiumBlockError, isUniqueViolation,
} from './cloudDocs'
import { docToPayload } from './syncProtocol'
import type { VyroDoc } from './types'

// A minimal chainable stand-in for the supabase-js query builder: it
// records the call shape and resolves with the programmed result.
interface Call { table: string; op: string; payload?: any; filters: [string, any][]; terminal: string }
type Res = { data?: any; error?: any }

function makeFakeClient(program: (call: Call) => Res) {
  const calls: Call[] = []
  const finish = (call: Call, terminal: string) => {
    call.terminal = terminal
    calls.push(call)
    return Promise.resolve(program(call))
  }
  const builder = (table: string) => {
    const call: Call = { table, op: 'select', filters: [], terminal: 'await' }
    const b: any = {
      select() { return b },
      insert(p: any) { call.op = 'insert'; call.payload = p; return b },
      update(p: any) { call.op = 'update'; call.payload = p; return b },
      delete() { call.op = 'delete'; return b },
      eq(k: string, v: any) { call.filters.push([k, v]); return b },
      single() { return finish(call, 'single') },
      maybeSingle() { return finish(call, 'maybeSingle') },
      then(onF: any, onR: any) { return finish(call, 'await').then(onF, onR) },
    }
    return b
  }
  return { client: { from: (t: string) => builder(t) } as any, calls }
}

const doc = (partial: Partial<VyroDoc> = {}): VyroDoc => ({
  id: 'd1', title: 'T', content: { type: 'doc', content: [{ type: 'paragraph' }] },
  folder: '', favorite: false, dir: 'ltr',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', ...partial,
})
const payload = docToPayload(doc())
const row = { ...payload, revision: 1, server_updated_at: '2026-01-03T00:00:00.000Z' }

describe('cloudDocs', () => {
  it('fetchDocumentList reads the documents table and returns rows', async () => {
    const { client, calls } = makeFakeClient(() => ({ data: [row] }))
    const res = await fetchDocumentList(client)
    expect(res).toEqual({ ok: true, value: [row] })
    expect(calls[0].table).toBe('documents')
    expect(calls[0].op).toBe('select')
  })
  it('fetchDocument returns the row, or null when there is none', async () => {
    const { client, calls } = makeFakeClient(() => ({ data: row }))
    expect(await fetchDocument(client, 'd1')).toEqual({ ok: true, value: row })
    expect(calls[0].filters).toEqual([['id', 'd1']])
    const empty = makeFakeClient(() => ({ data: null }))
    expect(await fetchDocument(empty.client, 'ghost')).toEqual({ ok: true, value: null })
  })
  it('insertDocument sends the payload untouched — no owner_id, no premium flag, no revision', async () => {
    const { client, calls } = makeFakeClient(() => ({ data: row }))
    const res = await insertDocument(client, payload)
    expect(res).toEqual({ ok: true, value: row })
    expect(calls[0].op).toBe('insert')
    expect(calls[0].payload).toEqual(payload)
    expect(calls[0].payload).not.toHaveProperty('owner_id')
    expect(calls[0].payload).not.toHaveProperty('revision')
    expect(calls[0].payload).not.toHaveProperty('premium')
  })
  it('updateDocument predicates on the base revision and writes base+1', async () => {
    const updated = { ...row, revision: 4 }
    const { client, calls } = makeFakeClient(() => ({ data: [updated] }))
    const res = await updateDocument(client, 'd1', 3, payload)
    expect(res).toEqual({ ok: true, value: [updated] })
    expect(calls[0].op).toBe('update')
    expect(calls[0].payload.revision).toBe(4)
    expect(calls[0].payload).not.toHaveProperty('owner_id')
    expect(calls[0].filters).toEqual([['id', 'd1'], ['revision', 3]])
  })
  it('a zero-row update is a successful EMPTY result, not an error (protocol signal)', async () => {
    const { client } = makeFakeClient(() => ({ data: [] }))
    expect(await updateDocument(client, 'd1', 3, payload)).toEqual({ ok: true, value: [] })
  })
  it('deleteDocument deletes by id and treats errors as values', async () => {
    const { client, calls } = makeFakeClient(() => ({ data: null }))
    expect(await deleteDocument(client, 'd1')).toEqual({ ok: true, value: true })
    expect(calls[0].op).toBe('delete')
    expect(calls[0].filters).toEqual([['id', 'd1']])
  })
  it('PostgREST errors are normalised to CloudError values, never thrown', async () => {
    const { client } = makeFakeClient(() => ({ error: { message: 'permission denied', code: '42501' } }))
    const res = await insertDocument(client, payload)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.message).toBe('permission denied')
      expect(res.error.code).toBe('42501')
      expect(isPremiumBlockError(res.error)).toBe(true)
    }
    const throwing = { from: () => { throw new Error('network down') } } as any
    const res2 = await fetchDocumentList(throwing)
    expect(res2.ok).toBe(false)
    if (!res2.ok) expect(res2.error.message).toBe('network down')
  })
  it('error classifiers key off the Postgres codes', () => {
    expect(isUniqueViolation({ message: 'dup', code: '23505' })).toBe(true)
    expect(isUniqueViolation({ message: 'x', code: '42501' })).toBe(false)
    expect(isPremiumBlockError({ message: 'x' })).toBe(false)
  })
})
