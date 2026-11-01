// Stage 2B — the persisted sync outbox (vyro-web-outbox-v1).
//
// Design rules, mirroring versions.ts / recovery.ts:
// - The outbox is the ONLY record of "what still owes the server a write".
//   An entry leaves the store ONLY on server acknowledgement (the sync
//   engine removes it after the server returns the new revision) or when
//   the protocol deliberately consumes it (a recorded conflict, whose
//   content is preserved in a version snapshot first).
// - Entries are account-scoped: one browser can hold several accounts'
//   queues; no account's engine ever touches another account's entries.
// - Storage access never throws: loads degrade to [], saves report false
//   and leave previously stored data untouched.
// - The payload itself is NOT stored — only its hash. Execution re-reads
//   the live document, so a queued op always sends the newest content.

import { collapseOps, type SyncOp, type SyncOpType } from './syncProtocol'

export const OUTBOX_KEY = 'vyro-web-outbox-v1'

const OP_TYPES: SyncOpType[] = ['insert', 'update', 'delete']

/** Validate one stored entry; returns the cleaned entry or null. Never throws. */
export function validateOp(raw: any): SyncOp | null {
  try {
    if (!raw || typeof raw !== 'object') return null
    if (typeof raw.accountId !== 'string' || !raw.accountId) return null
    if (typeof raw.docId !== 'string' || !raw.docId) return null
    if (!OP_TYPES.includes(raw.op)) return null
    if (typeof raw.baseRevision !== 'number' || !Number.isFinite(raw.baseRevision) || raw.baseRevision < 0) return null
    if (typeof raw.payloadHash !== 'string' || !raw.payloadHash) return null
    if (typeof raw.queuedAt !== 'string' || Number.isNaN(new Date(raw.queuedAt).getTime())) return null
    return {
      accountId: raw.accountId,
      docId: raw.docId,
      op: raw.op,
      baseRevision: Math.floor(raw.baseRevision),
      payloadHash: raw.payloadHash,
      queuedAt: raw.queuedAt,
    }
  } catch {
    return null
  }
}

type StorageLike = Pick<Storage, 'getItem'> & Partial<Pick<Storage, 'setItem'>>

/**
 * Load the whole outbox (all accounts). Missing key, unreadable storage,
 * unparseable JSON or a non-array payload all yield [] — and load NEVER
 * writes, so a corrupt payload is never overwritten by reading it.
 * Individually corrupt entries are dropped; healthy entries survive.
 */
export function loadOutbox(storage: StorageLike): SyncOp[] {
  let raw: string | null = null
  try { raw = storage.getItem(OUTBOX_KEY) } catch { return [] }
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(validateOp).filter((o): o is SyncOp => o !== null)
  } catch {
    return []
  }
}

/**
 * Persist the whole outbox. Returns false (never throws) when any entry
 * is invalid or the write fails (e.g. QuotaExceededError); in both cases
 * nothing is written, so previously stored data stays intact.
 */
export function saveOutbox(storage: Pick<Storage, 'setItem'>, ops: SyncOp[]): boolean {
  if (ops.some((o) => validateOp(o) === null)) return false
  try {
    storage.setItem(OUTBOX_KEY, JSON.stringify(ops))
    return true
  } catch {
    return false
  }
}

/**
 * Enqueue one op (protocol collapsing applied) and persist. Returns the
 * resulting queue — the in-memory result is authoritative for the caller
 * even if the persist itself failed (saveOutbox reports separately via
 * the engine's own save path; here a failed write still returns the
 * collapsed queue so the session's sync can proceed).
 */
export function enqueueOp(storage: StorageLike & Pick<Storage, 'setItem'>, queue: SyncOp[], op: SyncOp): SyncOp[] {
  const next = collapseOps(queue, op)
  saveOutbox(storage, next)
  return next
}

/** Number of ops still owed to the server for one account. */
export function pendingCountFor(queue: SyncOp[], accountId: string): number {
  return queue.reduce((n, o) => n + (o.accountId === accountId ? 1 : 0), 0)
}
