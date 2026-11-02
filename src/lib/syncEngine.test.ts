import { describe, it, expect } from 'vitest'
import { SyncEngine, type SyncAck } from './syncEngine'
import { loadOutbox, OUTBOX_KEY } from './outbox'
import { docToPayload, payloadHashOf, type SyncOp } from './syncProtocol'
import type { VyroDoc } from './types'

// A stateful fake of the staging documents table: it implements the real
// revision protocol (insert → revision 1; predicated update matches only
// the base revision and returns base+1; RLS premium refusals as a 42501
// error on insert and as zero matched rows on update), so the engine is
// tested against the protocol, not against a stub's good mood.
interface Call { table: string; op: string; payload?: any; filters: [string, any][]; terminal: string }

class FakeServer {
  rows = new Map<string, any>()
  calls: Call[] = []
  networkDown = false
  premiumBlockInsert = false
  premiumBlockUpdate = false
  onInsert: (() => void) | null = null

  handle = (call: Call): { data?: any; error?: any } => {
    if (this.networkDown) return { error: { message: 'Failed to fetch' } }
    switch (call.op) {
      case 'insert': {
        if (this.premiumBlockInsert) return { error: { message: 'permission denied', code: '42501' } }
        if (this.rows.has(call.payload.id)) return { error: { message: 'duplicate key', code: '23505' } }
        const row = { ...call.payload, revision: 1, server_updated_at: '2026-02-01T00:00:00.000Z' }
        this.rows.set(row.id, row)
        this.onInsert?.()
        return { data: row }
      }
      case 'update': {
        const id = call.filters.find((f) => f[0] === 'id')![1]
        const base = call.filters.find((f) => f[0] === 'revision')![1]
        if (this.premiumBlockUpdate) return { data: [] }
        const cur = this.rows.get(id)
        if (!cur || cur.revision !== base) return { data: [] }
        const row = { ...cur, ...call.payload, server_updated_at: '2026-02-01T00:00:00.000Z' }
        this.rows.set(id, row)
        return { data: [row] }
      }
      case 'delete': {
        const id = call.filters.find((f) => f[0] === 'id')![1]
        this.rows.delete(id)
        return { data: null }
      }
      default: { // select
        const idF = call.filters.find((f) => f[0] === 'id')
        if (call.terminal === 'maybeSingle') return { data: idF ? (this.rows.get(idF[1]) ?? null) : null }
        return { data: [...this.rows.values()] }
      }
    }
  }

  client() {
    const server = this
    const builder = (table: string) => {
      const call: Call = { table, op: 'select', filters: [], terminal: 'await' }
      const finish = (terminal: string) => { call.terminal = terminal; server.calls.push(call); return Promise.resolve(server.handle(call)) }
      const b: any = {
        select() { return b },
        insert(p: any) { call.op = 'insert'; call.payload = p; return b },
        update(p: any) { call.op = 'update'; call.payload = p; return b },
        delete() { call.op = 'delete'; return b },
        eq(k: string, v: any) { call.filters.push([k, v]); return b },
        single() { return finish('single') },
        maybeSingle() { return finish('maybeSingle') },
        then(onF: any, onR: any) { return finish('await').then(onF, onR) },
      }
      return b
    }
    return { from: (t: string) => builder(t) } as any
  }

  seed(doc: VyroDoc, revision: number) {
    this.rows.set(doc.id, { ...docToPayload(doc), revision, server_updated_at: '2026-02-01T00:00:00.000Z' })
  }
  updatesFor(id: string) { return this.calls.filter((c) => c.op === 'update' && c.filters.some((f) => f[0] === 'id' && f[1] === id)) }
}

function fakeStorage() {
  const m = new Map<string, string>()
  return { map: m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } }
}

const text = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
function doc(partial: Partial<VyroDoc> = {}): VyroDoc {
  return {
    id: 'd1', title: 'Title', content: text('hello'), folder: '', favorite: false, dir: 'ltr',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', ...partial,
  }
}
const op = (partial: Partial<SyncOp> = {}): SyncOp => ({
  accountId: 'acc1', docId: 'd1', op: 'insert', baseRevision: 0,
  payloadHash: 'h', queuedAt: '2026-02-01T00:00:00.000Z', ...partial,
})

function makeHarness(server: FakeServer) {
  const storage = fakeStorage()
  const localDocs: VyroDoc[] = []
  const acks: { docId: string; ack: SyncAck }[] = []
  const adopted: VyroDoc[] = []
  const conflicts: VyroDoc[] = []
  const timers: { fn: () => void; ms: number }[] = []
  let online = true
  const makeEngine = () => new SyncEngine({
    client: server.client(),
    accountId: 'acc1',
    storage: storage as any,
    getDoc: (id) => localDocs.find((d) => d.id === id),
    getDocs: () => localDocs,
    onSynced: (docId, ack) => {
      acks.push({ docId, ack })
      const d = localDocs.find((x) => x.id === docId)
      if (d) { d.cloudRevision = ack.revision; d.cloudHash = ack.hash; d.cloudSyncedAt = ack.syncedAt }
    },
    onAdoptRemote: (remote) => {
      adopted.push(remote)
      const i = localDocs.findIndex((x) => x.id === remote.id)
      if (i >= 0) localDocs[i] = remote; else localDocs.unshift(remote)
    },
    onConflict: (d) => {
      conflicts.push(d)
      const local = localDocs.find((x) => x.id === d.id)
      if (local && !local.cloudConflict) local.cloudConflict = '2026-02-02T00:00:00.000Z'
    },
    now: () => new Date('2026-02-01T12:00:00.000Z'),
    rand: () => 0.5,
    schedule: (fn, ms) => { const t = { fn, ms }; timers.push(t); return () => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1) } },
    isOnline: () => online,
    debounceMs: 0,
  })
  const engine = makeEngine()
  return {
    server, storage, localDocs, acks, adopted, conflicts, timers, engine, makeEngine,
    setOnline: (v: boolean) => { online = v },
    fireNextTimer: async () => { const t = timers.shift(); if (t) { t.fn(); await engine.whenIdle() } },
  }
}

describe('push: insert / update acks', () => {
  it('insert is removed from the outbox ONLY after the server ack, with revision 1', async () => {
    const h = makeHarness(new FakeServer())
    const d = doc(); h.localDocs.push(d)
    h.engine.enqueue(op())
    expect(loadOutbox(h.storage as any)).toHaveLength(1) // queued, not yet acked
    await h.engine.runNow()
    expect(h.server.rows.get('d1')?.revision).toBe(1)
    expect(h.acks).toEqual([{ docId: 'd1', ack: { revision: 1, hash: payloadHashOf(d), syncedAt: '2026-02-01T12:00:00.000Z' } }])
    expect(loadOutbox(h.storage as any)).toHaveLength(0)
    expect(d.cloudRevision).toBe(1)
    expect(h.engine.statusFor(d)).toBe('synced')
  })
  it('update predicates on the base revision and acks at base+1', async () => {
    const server = new FakeServer()
    const h = makeHarness(server)
    const d = doc({ cloudRevision: 1 }); d.cloudHash = payloadHashOf(doc())
    server.seed(doc(), 1)
    h.localDocs.push({ ...d, title: 'Edited' })
    h.engine.enqueue(op({ op: 'update', baseRevision: 1 }))
    await h.engine.runNow()
    expect(server.rows.get('d1')?.revision).toBe(2)
    expect(server.rows.get('d1')?.title).toBe('Edited')
    expect(h.acks[0].ack.revision).toBe(2)
  })
  it('processes ops one at a time in queue order', async () => {
    const server = new FakeServer()
    const h = makeHarness(server)
    h.localDocs.push(doc({ id: 'a' }), doc({ id: 'b' }))
    h.engine.enqueue(op({ docId: 'a' }))
    h.engine.enqueue(op({ docId: 'b' }))
    await h.engine.runNow()
    expect(server.calls.filter((c) => c.op === 'insert').map((c) => c.payload.id)).toEqual(['a', 'b'])
  })
  it('a re-enqueue folded DURING the insert flight does not resurrect the acked op (no false conflict)', async () => {
    const server = new FakeServer()
    const h = makeHarness(server)
    const d = doc(); h.localDocs.push(d)
    server.onInsert = () => {
      // Simulates the hook's doc-change effect folding a fresh enqueue
      // into the in-flight op (new queuedAt) while the insert is out.
      d.title = 'Changed mid-flight'
      h.engine.enqueue(op({ queuedAt: '2026-02-01T03:00:00.000Z' }))
    }
    h.engine.enqueue(op())
    await h.engine.runNow()
    expect(h.conflicts).toHaveLength(0)
    expect(server.rows.get('d1')?.revision).toBe(2)
    expect(server.rows.get('d1')?.title).toBe('Changed mid-flight')
    expect(loadOutbox(h.storage as any)).toHaveLength(0)
  })
  it('an edit made DURING the insert flight is not lost: a follow-up update carries it', async () => {
    const server = new FakeServer()
    const h = makeHarness(server)
    const d = doc(); h.localDocs.push(d)
    server.onInsert = () => { d.title = 'Changed mid-flight' }
    h.engine.enqueue(op())
    await h.engine.runNow()
    expect(server.rows.get('d1')?.revision).toBe(2)
    expect(server.rows.get('d1')?.title).toBe('Changed mid-flight')
    expect(h.acks.map((a) => a.ack.revision)).toEqual([1, 2])
    expect(loadOutbox(h.storage as any)).toHaveLength(0)
  })
})

describe('push: failure keeps the op', () => {
  it('network failure: op stays persisted, doc reads failed, a fresh engine sees the queue, retry after heal acks', async () => {
    const server = new FakeServer()
    const h = makeHarness(server)
    const d = doc(); h.localDocs.push(d)
    server.networkDown = true
    h.engine.enqueue(op())
    await h.engine.runNow()
    expect(h.acks).toHaveLength(0)
    expect(loadOutbox(h.storage as any)).toHaveLength(1) // still owed
    expect(h.engine.statusFor(d)).toBe('failed')
    // "Reload": a new engine over the same storage inherits the queue.
    expect(h.makeEngine().getPendingCount()).toBe(1)
    server.networkDown = false
    await h.fireNextTimer() // the scheduled backoff retry
    expect(h.acks).toHaveLength(1)
    expect(loadOutbox(h.storage as any)).toHaveLength(0)
    expect(h.engine.statusFor(d)).toBe('synced')
  })
  it('offline: the loop does nothing and the op simply waits', async () => {
    const server = new FakeServer()
    const h = makeHarness(server)
    h.localDocs.push(doc())
    h.setOnline(false)
    h.engine.enqueue(op())
    await h.engine.runNow()
    expect(server.calls).toHaveLength(0)
    expect(loadOutbox(h.storage as any)).toHaveLength(1)
    h.setOnline(true)
    await h.engine.runNow()
    expect(loadOutbox(h.storage as any)).toHaveLength(0)
  })
})

describe('push: premium refusal pauses the queue, ops kept', () => {
  it('insert refused by RLS (42501): pause, nothing dropped, later ops untouched', async () => {
    const server = new FakeServer()
    const h = makeHarness(server)
    h.localDocs.push(doc({ id: 'a' }), doc({ id: 'b' }))
    server.premiumBlockInsert = true
    h.engine.enqueue(op({ docId: 'a' }))
    h.engine.enqueue(op({ docId: 'b' }))
    await h.engine.runNow()
    expect(h.engine.isPausedPremium()).toBe(true)
    expect(server.rows.size).toBe(0)
    expect(loadOutbox(h.storage as any)).toHaveLength(2) // BOTH ops kept
    server.premiumBlockInsert = false
    h.engine.resume()
    await h.engine.runNow()
    expect(server.rows.size).toBe(2)
    expect(loadOutbox(h.storage as any)).toHaveLength(0)
  })
  it('zero-row update with the row still at our base = write-block: pause, op kept', async () => {
    const server = new FakeServer()
    const h = makeHarness(server)
    const d = doc({ cloudRevision: 1 }); d.cloudHash = payloadHashOf(doc())
    server.seed(doc(), 1)
    h.localDocs.push({ ...d, title: 'Edited' })
    server.premiumBlockUpdate = true
    h.engine.enqueue(op({ op: 'update', baseRevision: 1 }))
    await h.engine.runNow()
    expect(h.engine.isPausedPremium()).toBe(true)
    expect(h.conflicts).toHaveLength(0) // NOT misreported as a conflict
    expect(loadOutbox(h.storage as any)).toHaveLength(1)
    server.premiumBlockUpdate = false
    h.engine.resume()
    await h.engine.runNow()
    expect(server.rows.get('d1')?.revision).toBe(2)
  })
})

describe('push: stale writes never overwrite — conflict path', () => {
  it('another writer moved the server: conflict recorded, local content untouched, op consumed', async () => {
    const server = new FakeServer()
    const h = makeHarness(server)
    server.seed(doc({ title: 'Server version', content: text('server text') }), 3)
    const local = doc({ title: 'Local version', content: text('local text'), cloudRevision: 1 })
    local.cloudHash = payloadHashOf(doc())
    h.localDocs.push(local)
    h.engine.enqueue(op({ op: 'update', baseRevision: 1 }))
    await h.engine.runNow()
    expect(h.conflicts).toHaveLength(1)
    expect(local.cloudConflict).toBeTruthy()
    expect(local.content).toEqual(text('local text')) // never overwritten
    expect(server.rows.get('d1')?.title).toBe('Server version') // server untouched too
    expect(server.updatesFor('d1')).toHaveLength(1) // exactly one (predicated, zero-row) attempt
    expect(loadOutbox(h.storage as any)).toHaveLength(0) // op consumed by the conflict record
    expect(h.engine.statusFor(local)).toBe('conflict')
  })
  it('server copy was hard-deleted elsewhere: conflict, never a silent resurrection', async () => {
    const server = new FakeServer()
    const h = makeHarness(server)
    const local = doc({ cloudRevision: 2 }); local.cloudHash = payloadHashOf(doc())
    h.localDocs.push({ ...local, title: 'Edited' })
    h.engine.enqueue(op({ op: 'update', baseRevision: 2 }))
    await h.engine.runNow()
    expect(h.conflicts).toHaveLength(1)
    expect(server.rows.size).toBe(0)
  })
  it('insert hitting an IDENTICAL server row adopts its revision (no conflict)', async () => {
    const server = new FakeServer()
    const h = makeHarness(server)
    const d = doc(); server.seed(d, 1)
    h.localDocs.push(d)
    h.engine.enqueue(op())
    await h.engine.runNow()
    expect(h.conflicts).toHaveLength(0)
    expect(h.acks[0].ack.revision).toBe(1)
    expect(loadOutbox(h.storage as any)).toHaveLength(0)
  })
  it('insert hitting a DIFFERENT server row is a conflict', async () => {
    const server = new FakeServer()
    const h = makeHarness(server)
    server.seed(doc({ title: 'Theirs', content: text('theirs') }), 1)
    h.localDocs.push(doc({ title: 'Mine', content: text('mine') }))
    h.engine.enqueue(op())
    await h.engine.runNow()
    expect(h.conflicts).toHaveLength(1)
    expect(server.rows.get('d1')?.title).toBe('Theirs')
  })
  it('same content edit on both devices converges: metadata rebases instead of conflicting', async () => {
    const server = new FakeServer()
    const h = makeHarness(server)
    // Server: rev 2, same content as local, different title.
    server.seed(doc({ title: 'Their title', content: text('same text') }), 2)
    const local = doc({ title: 'My title', content: text('same text'), cloudRevision: 1 })
    local.cloudHash = payloadHashOf(doc())
    h.localDocs.push(local)
    h.engine.enqueue(op({ op: 'update', baseRevision: 1 }))
    await h.engine.runNow()
    expect(h.conflicts).toHaveLength(0)
    expect(server.rows.get('d1')?.revision).toBe(3)
    expect(server.rows.get('d1')?.title).toBe('My title')
    expect(h.acks[h.acks.length - 1].ack.revision).toBe(3)
  })
})

describe('push: delete', () => {
  it('hard delete acks by removing the op; deleting a gone row is fine', async () => {
    const server = new FakeServer()
    const h = makeHarness(server)
    server.seed(doc(), 1)
    h.engine.enqueue(op({ op: 'delete', baseRevision: 1 }))
    await h.engine.runNow()
    expect(server.rows.size).toBe(0)
    expect(loadOutbox(h.storage as any)).toHaveLength(0)
    h.engine.enqueue(op({ docId: 'ghost', op: 'delete', baseRevision: 1 }))
    await h.engine.runNow()
    expect(loadOutbox(h.storage as any)).toHaveLength(0)
  })
})

describe('pull (refetch-on-focus)', () => {
  it('adopts a server-only document with its cloud link stamped', async () => {
    const server = new FakeServer()
    const h = makeHarness(server)
    server.seed(doc({ id: 'srv1', title: 'From another device' }), 1)
    await h.engine.pull()
    expect(h.adopted).toHaveLength(1)
    expect(h.localDocs[0].id).toBe('srv1')
    expect(h.localDocs[0].cloudRevision).toBe(1)
    expect(h.engine.statusFor(h.localDocs[0])).toBe('synced')
  })
  it('refreshes a CLEAN local doc when the server is newer', async () => {
    const server = new FakeServer()
    const h = makeHarness(server)
    const clean = doc(); clean.cloudRevision = 1; clean.cloudHash = payloadHashOf(clean)
    h.localDocs.push(clean)
    server.seed(doc({ title: 'Newer', content: text('newer text') }), 2)
    await h.engine.pull()
    expect(h.adopted).toHaveLength(1)
    expect(h.localDocs[0].title).toBe('Newer')
    expect(h.localDocs[0].cloudRevision).toBe(2)
    expect(h.conflicts).toHaveLength(0)
  })
  it('never overwrites a DIRTY local doc: pull records a conflict instead', async () => {
    const server = new FakeServer()
    const h = makeHarness(server)
    const clean = doc(); clean.cloudRevision = 1; clean.cloudHash = payloadHashOf(clean)
    const dirty = { ...clean, title: 'Unsaved local edit', content: text('local words') }
    h.localDocs.push(dirty)
    server.seed(doc({ title: 'Server newer', content: text('server words') }), 2)
    await h.engine.pull()
    expect(h.adopted).toHaveLength(0)
    expect(h.conflicts).toHaveLength(1)
    expect(h.localDocs[0].content).toEqual(text('local words'))
  })
  it('links an identical never-linked doc and leaves it synced', async () => {
    const server = new FakeServer()
    const h = makeHarness(server)
    const local = doc(); server.seed(local, 1)
    h.localDocs.push(local)
    await h.engine.pull()
    expect(h.adopted).toHaveLength(0)
    expect(h.conflicts).toHaveLength(0)
    expect(local.cloudRevision).toBe(1)
    expect(h.engine.statusFor(local)).toBe('synced')
  })
  it('never resurrects a doc with a pending hard delete', async () => {
    const server = new FakeServer()
    const h = makeHarness(server)
    server.seed(doc(), 1)
    h.engine.enqueue(op({ op: 'delete', baseRevision: 1 }))
    await h.engine.pull()
    expect(h.adopted).toHaveLength(0)
    expect(h.localDocs).toHaveLength(0)
  })
  it('a failed list fetch is silent: no adopts, no conflicts, no crash', async () => {
    const server = new FakeServer()
    const h = makeHarness(server)
    server.networkDown = true
    await h.engine.pull()
    expect(h.adopted).toHaveLength(0)
    expect(h.conflicts).toHaveLength(0)
  })
})

describe('outbox storage key', () => {
  it('persists under the Stage 2 key', async () => {
    const h = makeHarness(new FakeServer())
    h.localDocs.push(doc())
    h.engine.enqueue(op())
    expect(h.storage.map.has(OUTBOX_KEY)).toBe(true)
    expect(OUTBOX_KEY).toBe('vyro-web-outbox-v1')
  })
})
