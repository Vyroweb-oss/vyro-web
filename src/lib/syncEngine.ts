// Stage 2B — the sync engine: drives the outbox against the cloud tables.
//
// One engine instance exists per signed-in account, and ONLY while the
// cloud flag is on, Supabase is configured, and the user is Premium (the
// hook in components/useCloudSync enforces that lifecycle; free users get
// no engine at all, matching the server's own enforcement).
//
// Behaviour contract (Stage 2 plan §3/§4/§6):
// - Ops run strictly one at a time, in queue order. An op leaves the
//   persisted outbox ONLY after the server acknowledges it (insert/update
//   returning the new revision) or after the protocol deliberately
//   consumes it (a recorded conflict; a doc that no longer exists).
// - A failed op stays queued: retry with the protocol backoff. A
//   server-side Premium refusal (RLS 42501, or a predicated update that
//   matches zero rows while the row still sits at our base) PAUSES the
//   whole queue and keeps every op — sync resumes on renewal; local
//   editing is never affected.
// - A stale-revision outcome NEVER overwrites anything: the engine calls
//   onConflict (the hook snapshots the local content into the versions
//   store and marks the doc) and drops the consumed op.
// - Offline = paused: the loop does nothing and ops simply wait.
// - Pull (refetch-on-focus) only ADDS or refreshes clean local copies and
//   links identical ones; it never uploads and never touches a dirty or
//   conflicted document.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  collapseOps, removeMatchingOp, opsForAccount, pendingOpsFor, payloadHashOf,
  contentHashOf, docToPayload, rowToDoc, backoffDelayMs, classifyUpdateAck,
  classifyZeroRowUpdate, classifyInsertConflict, deriveDocSyncStatus,
  planPullMerge, type SyncOp, type DocSyncStatus,
} from './syncProtocol'
import {
  fetchDocument, fetchDocumentList, insertDocument, updateDocument,
  deleteDocument, isPremiumBlockError, isUniqueViolation,
} from './cloudDocs'
import { loadOutbox, saveOutbox, pendingCountFor } from './outbox'
import type { VyroDoc } from './types'

export interface SyncAck { revision: number; hash: string; syncedAt: string }

export interface SyncEngineDeps {
  client: SupabaseClient
  accountId: string
  storage: Pick<Storage, 'getItem' | 'setItem'>
  /** Current local doc (the engine always sends the newest local state). */
  getDoc: (id: string) => VyroDoc | undefined
  getDocs: () => VyroDoc[]
  /** Server acknowledged a write: stamp the doc's cloud fields. */
  onSynced: (docId: string, ack: SyncAck) => void
  /** Pull adopted/refreshed a doc from the server: add/replace it locally. */
  onAdoptRemote: (doc: VyroDoc) => void
  /** A conflict was detected: snapshot + mark the doc (content preserved). */
  onConflict: (doc: VyroDoc) => void
  /** Queue/runtime changed — React state should recompute statuses. */
  onChange?: () => void
  now?: () => Date
  rand?: () => number
  /** Injectable scheduler (setTimeout by default); returns a cancel fn. */
  schedule?: (fn: () => void, ms: number) => () => void
  isOnline?: () => boolean
  /** Debounce between an enqueue and the loop starting (plan: ~2s). */
  debounceMs?: number
}

type ProcessOutcome = 'done' | 'retry' | 'paused'

const defaultSchedule = (fn: () => void, ms: number) => {
  const h = setTimeout(fn, ms)
  return () => clearTimeout(h)
}

export class SyncEngine {
  private deps: SyncEngineDeps
  private queue: SyncOp[]
  private attempts = new Map<string, number>()
  private failedDocs = new Set<string>()
  private inFlightDocId: string | null = null
  private pausedPremium = false
  private running: Promise<void> | null = null
  private pulling: Promise<void> | null = null
  private cancelScheduled: (() => void) | null = null
  private disposed = false

  constructor(deps: SyncEngineDeps) {
    this.deps = deps
    this.queue = loadOutbox(deps.storage)
  }

  // -- queue ---------------------------------------------------------------

  enqueue(op: SyncOp): void {
    if (this.disposed) return
    this.queue = collapseOps(this.queue, op)
    this.persist()
    this.deps.onChange?.()
    this.kick()
  }

  getQueue(): SyncOp[] { return this.queue }
  getPendingCount(): number { return pendingCountFor(this.queue, this.deps.accountId) }
  isPausedPremium(): boolean { return this.pausedPremium }

  /** Explicit resume (sign-in / focus / online / interval): clears a
   * Premium pause and retries — if the server still refuses, the loop
   * pauses again on the first op. */
  resume(): void {
    if (this.disposed) return
    this.pausedPremium = false
    this.kick()
  }

  kick(): void {
    if (this.disposed || this.pausedPremium) return
    // Always (re)arm the debounce — even while a run is in flight. The
    // running loop picks up ops enqueued BEFORE its final queue check,
    // but an op landing after that check and before the run settles
    // would otherwise wait forever for a wake event; the armed timer
    // closes that window (when it fires mid-run, runNow just returns
    // the in-flight promise).
    this.cancelScheduled?.()
    const schedule = this.deps.schedule ?? defaultSchedule
    this.cancelScheduled = schedule(() => { this.cancelScheduled = null; void this.runNow() }, this.deps.debounceMs ?? 2000)
  }

  dispose(): void {
    this.disposed = true
    this.cancelScheduled?.()
    this.cancelScheduled = null
  }

  /** Test/hook support: resolves when no run or pull is in flight. */
  async whenIdle(): Promise<void> {
    if (this.running) await this.running
    if (this.pulling) await this.pulling
  }

  // -- status --------------------------------------------------------------

  statusFor(doc: VyroDoc): DocSyncStatus {
    return deriveDocSyncStatus({
      linked: doc.cloudRevision != null,
      dirty: doc.cloudRevision != null && !!doc.cloudHash && payloadHashOf(doc) !== doc.cloudHash,
      pendingOps: pendingOpsFor(this.queue, this.deps.accountId, doc.id).length,
      inFlight: this.inFlightDocId === doc.id,
      failed: this.failedDocs.has(doc.id),
      conflicted: !!doc.cloudConflict,
    })
  }

  // -- push loop -------------------------------------------------------------

  runNow(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.running) return this.running
    const run = (async () => {
      while (!this.disposed && !this.pausedPremium) {
        if (this.deps.isOnline && !this.deps.isOnline()) break
        const op = opsForAccount(this.queue, this.deps.accountId)[0]
        if (!op) break
        const outcome = await this.process(op)
        if (outcome !== 'done') break
      }
    })()
    // Store the run promise ITSELF and clear it via .then — storing a
    // .finally()-wrapped promise instead would break the identity check
    // (this.running === run is never true for the wrapper) and wedge the
    // engine after its first run.
    this.running = run
    const clear = () => { if (this.running === run) this.running = null }
    run.then(clear, clear)
    return run
  }

  private async process(op: SyncOp): Promise<ProcessOutcome> {
    this.inFlightDocId = op.docId
    this.deps.onChange?.()
    try {
      switch (op.op) {
        case 'insert': return await this.processInsert(op)
        case 'update': return await this.processUpdate(op)
        case 'delete': return await this.processDelete(op)
      }
    } finally {
      this.inFlightDocId = null
      this.deps.onChange?.()
    }
    // Unreachable for the declared op union; an unrecognized op is
    // consumed (dropped) so it can never wedge the head of the queue.
    return this.drop(op)
  }

  private async processInsert(op: SyncOp): Promise<ProcessOutcome> {
    const doc = this.deps.getDoc(op.docId)
    if (!doc || doc.cloudConflict) return this.drop(op)
    const sentHash = payloadHashOf(doc)
    const res = await insertDocument(this.deps.client, docToPayload(doc))
    if (res.ok) return this.ack(op, res.value.revision, sentHash)
    if (isUniqueViolation(res.error)) {
      // A row with this id already exists on the server.
      const server = await fetchDocument(this.deps.client, op.docId)
      if (!server.ok) return this.retry(op)
      if (!server.value) return this.retry(op)
      const serverHash = payloadHashOf(rowToDoc(server.value))
      if (classifyInsertConflict(serverHash, sentHash) === 'adopt') {
        return this.ack(op, server.value.revision, sentHash)
      }
      if (contentHashOf(doc.content) === server.value.content_hash) {
        // Same content, drifted metadata: rebase as an update on the
        // server's revision instead of declaring a false conflict.
        return this.rebase(op, doc, server.value.revision)
      }
      return this.conflict(op, doc)
    }
    if (isPremiumBlockError(res.error)) return this.pause(op)
    return this.retry(op)
  }

  private async processUpdate(op: SyncOp): Promise<ProcessOutcome> {
    const doc = this.deps.getDoc(op.docId)
    if (!doc || doc.cloudConflict) return this.drop(op)
    const sentHash = payloadHashOf(doc)
    const res = await updateDocument(this.deps.client, op.docId, op.baseRevision, docToPayload(doc))
    if (!res.ok) {
      if (isPremiumBlockError(res.error)) return this.pause(op)
      return this.retry(op)
    }
    const ack = classifyUpdateAck(res.value.map((r) => r.revision), op.baseRevision)
    if (ack.kind === 'synced') return this.ack(op, ack.newRevision, sentHash)
    // Zero (or unusable) rows: re-read the server row and let the
    // protocol decide conflict vs write-block. Never overwrite.
    const server = await fetchDocument(this.deps.client, op.docId)
    if (!server.ok) return this.retry(op)
    if (server.value && server.value.revision === op.baseRevision) {
      // The row is exactly where we based this write, yet the predicated
      // update matched zero rows: the write itself was refused (RLS /
      // server-side Premium gate — classifyZeroRowUpdate's 'rejected').
      // The convergence shortcuts below cannot apply, nothing moved;
      // and rebasing onto this same base would retry the identical
      // refused write forever. Pause the queue, op kept.
      return this.pause(op)
    }
    if (server.value) {
      // Convergent cases first: if the server already holds exactly
      // this payload, the write's intent is satisfied — adopt its
      // revision as the ack. If only the CONTENT already matches
      // (both devices made the same edit; metadata drifted), rebase
      // the push on the server's revision instead of a false conflict.
      if (payloadHashOf(rowToDoc(server.value)) === sentHash) {
        return this.ack(op, server.value.revision, sentHash)
      }
      if (contentHashOf(doc.content) === server.value.content_hash) {
        return this.rebase(op, doc, server.value.revision)
      }
    }
    const verdict = classifyZeroRowUpdate(server.value ? server.value.revision : null, op.baseRevision)
    if (verdict === 'rejected') return this.pause(op)
    return this.conflict(op, doc)
  }

  private async processDelete(op: SyncOp): Promise<ProcessOutcome> {
    const res = await deleteDocument(this.deps.client, op.docId)
    if (res.ok) {
      this.queue = removeMatchingOp(this.queue, op)
      this.persist()
      this.attempts.delete(op.docId)
      this.failedDocs.delete(op.docId)
      this.deps.onChange?.()
      return 'done'
    }
    if (isPremiumBlockError(res.error)) return this.pause(op)
    return this.retry(op)
  }

  // -- outcome helpers -------------------------------------------------------

  /** Server acknowledged the write with a new revision: the ONLY path
   * that removes an op as "synced". If the doc changed again while the
   * request was in flight, a follow-up update op is queued on the new
   * base so the newest content still reaches the server. */
  private ack(op: SyncOp, newRevision: number, sentHash: string): ProcessOutcome {
    this.queue = removeMatchingOp(this.queue, op)
    this.persist()
    this.attempts.delete(op.docId)
    this.failedDocs.delete(op.docId)
    this.deps.onSynced(op.docId, { revision: newRevision, hash: sentHash, syncedAt: this.nowIso() })
    this.deps.onChange?.()
    const fresh = this.deps.getDoc(op.docId)
    if (fresh && !fresh.cloudConflict && payloadHashOf(fresh) !== sentHash) {
      this.queue = collapseOps(this.queue, {
        accountId: this.deps.accountId, docId: op.docId, op: 'update',
        baseRevision: newRevision, payloadHash: payloadHashOf(fresh), queuedAt: this.nowIso(),
      })
      this.persist()
      this.deps.onChange?.()
    }
    return 'done'
  }

  /** The op is deliberately consumed without an ack: its document is gone
   * locally, or a conflict was recorded for it (content preserved by the
   * onConflict snapshot). Never used for failures. */
  private drop(op: SyncOp): ProcessOutcome {
    this.queue = removeMatchingOp(this.queue, op)
    this.persist()
    this.deps.onChange?.()
    return 'done'
  }

  /** Consume this op and queue a fresh update predicated on the server's
   * current revision (used when the server already holds our content and
   * only metadata needs to travel). */
  private rebase(op: SyncOp, doc: VyroDoc, serverRevision: number): ProcessOutcome {
    this.drop(op)
    this.queue = collapseOps(this.queue, {
      accountId: this.deps.accountId, docId: op.docId, op: 'update',
      baseRevision: serverRevision, payloadHash: payloadHashOf(doc), queuedAt: this.nowIso(),
    })
    this.persist()
    this.deps.onChange?.()
    return 'done'
  }

  private conflict(op: SyncOp, doc: VyroDoc): ProcessOutcome {
    const fresh = this.deps.getDoc(op.docId) ?? doc
    this.drop(op)
    this.deps.onConflict(fresh)
    return 'done'
  }

  /** Server-side Premium refusal: pause the WHOLE queue, keep every op. */
  private pause(op: SyncOp): ProcessOutcome {
    this.pausedPremium = true
    this.failedDocs.add(op.docId)
    this.deps.onChange?.()
    return 'paused'
  }

  /** Retryable failure (network, 5xx, …): op stays, backoff retry is scheduled. */
  private retry(op: SyncOp): ProcessOutcome {
    const n = (this.attempts.get(op.docId) ?? 0) + 1
    this.attempts.set(op.docId, n)
    this.failedDocs.add(op.docId)
    this.deps.onChange?.()
    if (!this.disposed && !this.pausedPremium) {
      const schedule = this.deps.schedule ?? defaultSchedule
      this.cancelScheduled?.()
      this.cancelScheduled = schedule(() => { this.cancelScheduled = null; void this.runNow() }, backoffDelayMs(n, this.deps.rand))
    }
    return 'retry'
  }

  // -- pull ------------------------------------------------------------------

  /**
   * Refetch-on-focus merge. Only refreshes CLEAN local copies, adopts
   * server-only documents, links identical ones, and records conflicts —
   * it never uploads and never overwrites local edits. A doc with a
   * pending hard-delete op is never resurrected by a pull.
   */
  pull(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.pulling) return this.pulling
    const run = (async () => {
      const list = await fetchDocumentList(this.deps.client)
      if (!list.ok || this.disposed) return
      const actions = planPullMerge(this.deps.getDocs(), list.value)
      for (const action of actions) {
        if (this.disposed) return
        if (action.kind === 'ignore') continue
        if (pendingOpsFor(this.queue, this.deps.accountId, action.docId).some((o) => o.op === 'delete')) continue
        if (this.inFlightDocId === action.docId) continue
        if (action.kind === 'adopt' || action.kind === 'update-local') {
          const row = await fetchDocument(this.deps.client, action.docId)
          if (row.ok && row.value) this.deps.onAdoptRemote(rowToDoc(row.value))
        } else if (action.kind === 'link') {
          const meta = list.value.find((m) => m.id === action.docId)
          const local = this.deps.getDoc(action.docId)
          if (!meta || !local) continue
          // Stamp the server revision with a hash built from the SERVER's
          // metadata + the (identical) local content, so a metadata-only
          // difference still reads as dirty and pushes normally later.
          const serverView = rowToDoc({ ...meta, content: local.content })
          this.deps.onSynced(action.docId, {
            revision: meta.revision, hash: payloadHashOf(serverView), syncedAt: meta.server_updated_at,
          })
        } else if (action.kind === 'conflict') {
          const local = this.deps.getDoc(action.docId)
          if (local) this.deps.onConflict(local)
        }
      }
      this.deps.onChange?.()
    })()
    // Same identity rule as runNow: store the promise itself.
    this.pulling = run
    const clear = () => { if (this.pulling === run) this.pulling = null }
    run.then(clear, clear)
    return run
  }

  // -- internals ---------------------------------------------------------------

  private persist(): void { saveOutbox(this.deps.storage, this.queue) }
  private nowIso(): string { return (this.deps.now ? this.deps.now() : new Date()).toISOString() }
}
