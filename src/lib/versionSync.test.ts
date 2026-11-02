import { describe, it, expect } from 'vitest'
import { syncVersionsForDoc } from './versionSync'
import { planVersionSync, rowToVersion, versionToPayload } from './syncProtocol'
import { listVersions, loadVersions, saveVersions, type VersionSnapshot } from './versions'

// A minimal fake of the document_versions table over the same builder
// shape supabase-js exposes (select/eq/order + insert, thenable).
function fakeVersionsClient(seedRows: any[] = [], opts: { failFetch?: boolean; failInsert?: boolean; insertDupe?: boolean } = {}) {
  const store = { rows: seedRows.map((r) => ({ ...r })) }
  const builder = () => {
    const call: { op: string; payload?: any; filters: [string, any][] } = { op: 'select', filters: [] }
    const finish = () => {
      if (call.op === 'insert') {
        if (opts.failInsert) return Promise.resolve({ error: { message: 'boom' } })
        if (opts.insertDupe || store.rows.some((r) => r.id === call.payload.id)) {
          return Promise.resolve({ error: { message: 'duplicate key', code: '23505' } })
        }
        store.rows.push({ ...call.payload, owner_id: 'u1' })
        return Promise.resolve({ error: null })
      }
      if (opts.failFetch) return Promise.resolve({ data: null, error: { message: 'Failed to fetch' } })
      const docId = call.filters.find((f) => f[0] === 'doc_id')?.[1]
      return Promise.resolve({ data: store.rows.filter((r) => r.doc_id === docId), error: null })
    }
    const b: any = {
      select() { return b },
      insert(p: any) { call.op = 'insert'; call.payload = p; return b },
      eq(k: string, v: any) { call.filters.push([k, v]); return b },
      order() { return b },
      then(onF: any, onR: any) { return finish().then(onF, onR) },
    }
    return b
  }
  return { client: { from: () => builder() } as any, store }
}

function fakeStorage() {
  const m = new Map<string, string>()
  return { map: m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } }
}

const text = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const snap = (partial: Partial<VersionSnapshot> = {}): VersionSnapshot => ({
  id: 'v1', docId: 'd1', createdAt: '2026-01-01T00:00:00.000Z', trigger: 'manual',
  title: 'Title', content: text('hello'), ...partial,
})

describe('version row mapping', () => {
  it('payload carries the cloud column names and never owner_id', () => {
    const p = versionToPayload(snap({ label: 'Named' }))
    expect(p).toEqual({
      id: 'v1', doc_id: 'd1', created_at: '2026-01-01T00:00:00.000Z', label: 'Named',
      trigger: 'manual', title: 'Title', content: text('hello'),
    })
    expect('owner_id' in p).toBe(false)
  })

  it('round-trips labelled and unlabelled snapshots exactly', () => {
    for (const s of [snap(), snap({ id: 'v2', label: 'Conflict copy', trigger: 'before-risky' })]) {
      expect(rowToVersion({ ...versionToPayload(s), owner_id: 'u1' })).toEqual(s)
    }
  })

  it('drops a row whose trigger is outside the shared 7-value set', () => {
    expect(rowToVersion({ ...versionToPayload(snap()), trigger: 'bogus' as any })).toBeNull()
  })
})

describe('planVersionSync', () => {
  it('splits by id in both directions', () => {
    const local = [snap({ id: 'a' }), snap({ id: 'b' })]
    const remote = [snap({ id: 'b' }), snap({ id: 'c' })]
    const plan = planVersionSync(local, remote)
    expect(plan.upload.map((v) => v.id)).toEqual(['a'])
    expect(plan.download.map((v) => v.id)).toEqual(['c'])
  })
})

describe('syncVersionsForDoc', () => {
  it('uploads local-only snapshots, then a second run transfers nothing', async () => {
    const { client, store } = fakeVersionsClient()
    const storage = fakeStorage()
    saveVersions(storage as any, [snap({ id: 'a' }), snap({ id: 'b', createdAt: '2026-01-02T00:00:00.000Z' })])
    const r1 = await syncVersionsForDoc(client, storage as any, 'd1')
    expect(r1).toEqual({ uploaded: 2, downloaded: 0, failed: false })
    expect(store.rows.map((r) => r.id).sort()).toEqual(['a', 'b'])
    const r2 = await syncVersionsForDoc(client, storage as any, 'd1')
    expect(r2).toEqual({ uploaded: 0, downloaded: 0, failed: false })
  })

  it('downloads remote-only snapshots into the local store', async () => {
    const remoteSnap = snap({ id: 'c', title: 'From other device' })
    const { client } = fakeVersionsClient([{ ...versionToPayload(remoteSnap), owner_id: 'u1' }])
    const storage = fakeStorage()
    const r = await syncVersionsForDoc(client, storage as any, 'd1')
    expect(r).toEqual({ uploaded: 0, downloaded: 1, failed: false })
    expect(listVersions(loadVersions(storage as any), 'd1').map((v) => v.id)).toEqual(['c'])
  })

  it('a snapshot another device mirrored first (23505) counts as synced, not failure', async () => {
    const { client } = fakeVersionsClient([], { insertDupe: true })
    const storage = fakeStorage()
    saveVersions(storage as any, [snap({ id: 'a' })])
    const r = await syncVersionsForDoc(client, storage as any, 'd1')
    expect(r).toEqual({ uploaded: 1, downloaded: 0, failed: false })
  })

  it('fetch failure: reports failed and leaves the local store untouched', async () => {
    const { client } = fakeVersionsClient([], { failFetch: true })
    const storage = fakeStorage()
    saveVersions(storage as any, [snap({ id: 'a' })])
    const before = storage.map.get('vyro-web-versions-v1')
    const r = await syncVersionsForDoc(client, storage as any, 'd1')
    expect(r).toEqual({ uploaded: 0, downloaded: 0, failed: true })
    expect(storage.map.get('vyro-web-versions-v1')).toBe(before)
  })

  it('insert failure: reports failed; the snapshot stays local for the next cycle', async () => {
    const { client, store } = fakeVersionsClient([], { failInsert: true })
    const storage = fakeStorage()
    saveVersions(storage as any, [snap({ id: 'a' })])
    const r = await syncVersionsForDoc(client, storage as any, 'd1')
    expect(r.failed).toBe(true)
    expect(store.rows).toHaveLength(0)
    expect(listVersions(loadVersions(storage as any), 'd1')).toHaveLength(1)
  })
})
