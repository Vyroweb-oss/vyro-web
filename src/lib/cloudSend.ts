// Stage 2D — the per-document "send to cloud" decision, as a pure planner.
//
// The owner's rule (2026-11-01) is structural, and this planner is where it
// is enforced on the client: an insert op for a document may be created
// ONLY when every guard passes — the cloud engine is live, the account has
// consented (first-upload consent, Stage 0 §5.2), the document is not
// already linked, not conflicted, not trashed, and no insert for it is
// already queued. There is no code path that enqueues an insert for any
// other reason (the sync engine's passive effect never inserts).
//
// The server enforces the real boundary again on every write (RLS +
// cloud_premium_active), so a bypassed client planner still cannot upload
// for a free or expired account.

import type { VyroDoc } from './types'
import { contentHashOf, payloadHashOf, pendingOpsFor, type SyncOp } from './syncProtocol'

export type SendBlockReason =
  | 'inactive'
  | 'no-consent'
  | 'already-linked'
  | 'conflicted'
  | 'trashed'
  | 'already-queued'

export interface SendContext {
  /** Cloud engine live (flag on + configured + signed-in Premium). */
  engineActive: boolean
  /** First-upload consent timestamp for this account, or null. */
  consentAt: string | null
  accountId: string
  /** The account's current outbox queue (to spot a duplicate request). */
  queue: SyncOp[]
  nowIso: string
}

export type SendPlan =
  | { action: 'enqueue'; op: SyncOp }
  | { action: 'blocked'; reason: SendBlockReason }

export function planSendToCloud(doc: VyroDoc, ctx: SendContext): SendPlan {
  if (!ctx.engineActive) return { action: 'blocked', reason: 'inactive' }
  if (!ctx.consentAt) return { action: 'blocked', reason: 'no-consent' }
  if (doc.cloudRevision != null) return { action: 'blocked', reason: 'already-linked' }
  if (doc.cloudConflict) return { action: 'blocked', reason: 'conflicted' }
  if (doc.deletedAt) return { action: 'blocked', reason: 'trashed' }
  const pending = pendingOpsFor(ctx.queue, ctx.accountId, doc.id)
  if (pending.some((op) => op.op === 'insert')) return { action: 'blocked', reason: 'already-queued' }
  return {
    action: 'enqueue',
    op: {
      accountId: ctx.accountId,
      docId: doc.id,
      op: 'insert',
      baseRevision: 0,
      payloadHash: payloadHashOf(doc),
      queuedAt: ctx.nowIso,
    },
  }
}

// ---------------------------------------------------------------------------
// Link verification: after the engine's insert is acknowledged, the modal
// reads the server's meta row back and compares its stored content_hash
// with the local document's CONTENT hash. The column holds contentHashOf
// (the pairing the sync engine itself uses for insert-adopt); comparing
// it against the full-payload hash payloadHashOf can never match and
// produced a false "mismatch" for perfectly synced documents in the
// first live 2D rehearsal. Only an exact match is "verified"; anything
// else is surfaced, never smoothed over.
// ---------------------------------------------------------------------------

export type LinkVerification = 'verified' | 'mismatch' | 'missing'

export function classifyLinkVerification(
  serverContentHash: string | null | undefined,
  localContentHash: string,
): LinkVerification {
  if (serverContentHash == null) return 'missing'
  return serverContentHash === localContentHash ? 'verified' : 'mismatch'
}

/** Verify a freshly linked document against its server row's hash. */
export function verifyLinkHash(
  serverContentHash: string | null | undefined,
  doc: VyroDoc,
): LinkVerification {
  return classifyLinkVerification(serverContentHash, contentHashOf(doc.content))
}
