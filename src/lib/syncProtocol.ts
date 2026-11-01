// Stage 2B — cloud sync protocol: the PURE logic of the sync engine.
//
// Everything in this module is deterministic and side-effect free (no
// storage, no network, no Supabase import), so the whole protocol is
// unit-tested without a server: op collapsing, ordering, backoff, payload
// hashing, ack/conflict classification, per-document status derivation and
// pull-merge planning. cloudDocs.ts performs the actual PostgREST calls;
// syncEngine.ts drives the loop; this file decides what they should do.
//
// Protocol invariants (Stage 0/1/2 plan, enforced by the staging schema):
// - A document is "synced" ONLY when the server acknowledges a write with
//   the new revision (insert returns revision 1; an update predicated on
//   revision = base returns revision = base + 1 — the DB trigger enforces
//   exactly +1, so any other shape is not an ack).
// - A write predicated on a STALE base revision matches zero rows. Zero
//   rows is never treated as success and never retried blindly: the
//   server state decides whether it is a conflict (another writer won, or
//   the server copy is gone) or a write-block (row still at our base —
//   RLS refused, e.g. Premium lapsed mid-queue).
// - Nothing here ever decides to overwrite: conflict outcomes only RECORD
//   the conflict; resolution choices are Stage 2C UI.

import { stableStringify } from './recovery'
import { sanitizeDoc } from './store'
import type { VyroDoc } from './types'

// ---------------------------------------------------------------------------
// Content / payload hashing
//
// The schema's content_hash (and the read-back verification in §5 of the
// plan) needs a deterministic hash of the canonical document. The codebase
// has a canonical compare (stableStringify in recovery.ts) but no SHA-256
// helper, and crypto.subtle is async-only — the outbox must hash
// synchronously at enqueue time. So the client hash is a cyrb53 double
// hash over the canonical string: deterministic, key-order independent,
// and used ONLY for equality / read-back comparison (the documents table
// stores it as unconstrained text; the server never validates its format).

function cyrb53(str: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

/** Deterministic hash of an already-canonical string (two seeded passes, hex). */
export function hashCanonicalString(s: string): string {
  return cyrb53(s, 0x1a2b3c4d).toString(16).padStart(14, '0')
    + cyrb53(s, 0x5e6f7788).toString(16).padStart(14, '0')
}

/** Hash of a document's CONTENT only (what the server stores in content_hash). */
export function contentHashOf(content: any): string {
  return hashCanonicalString(stableStringify(content ?? null))
}

// ---------------------------------------------------------------------------
// Row mapping: VyroDoc <-> documents-table payload.
//
// The payload is EXACTLY the client-writable column set of the Stage 1
// schema. Server-owned fields (owner_id, server_updated_at) are never
// produced here: owner_id comes from the DB default auth.uid(), and no
// premium flag exists anywhere in the payload — entitlement lives only in
// the caller's JWT and the RLS policies.

export interface CloudDocPayload {
  id: string
  title: string
  content: any
  html: string | null
  folder: string
  favorite: boolean
  dir: 'ltr' | 'rtl'
  template_id: string | null
  margins: string | null
  orientation: string | null
  page_size: string | null
  page_w: number | null
  page_h: number | null
  custom_margins: { top: number; right: number; bottom: number; left: number } | null
  header_text: string | null
  footer_text: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  content_hash: string
}

/** A full documents-table row as read back (payload + server-owned fields). */
export interface CloudDocRow extends CloudDocPayload {
  revision: number
  server_updated_at: string
}

/** A documents-table row WITHOUT content (the list/pull projection). */
export type CloudDocMeta = Omit<CloudDocRow, 'content'>

export function docToPayload(doc: VyroDoc): CloudDocPayload {
  return {
    id: doc.id,
    title: doc.title,
    content: doc.content,
    html: doc.html ?? null,
    folder: doc.folder ?? '',
    favorite: !!doc.favorite,
    dir: doc.dir === 'rtl' ? 'rtl' : 'ltr',
    template_id: doc.templateId ?? null,
    // Canonicalized to the app's effective values (the same defaults
    // sanitizeDoc applies): an unset margins/orientation IS 'normal' /
    // 'portrait' everywhere in the app, so the payload — and therefore
    // payloadHashOf — must say so too. Leaving them null here made the
    // hash depend on whether the object had passed through sanitizeDoc:
    // a server row rebuilt by rowToDoc (sanitized) hashed differently
    // from the identical unsanitized local doc, which broke insert-adopt
    // and left pull-linked docs reading dirty forever.
    margins: doc.margins === 'narrow' || doc.margins === 'moderate' || doc.margins === 'wide' || doc.margins === 'custom' ? doc.margins : 'normal',
    orientation: doc.orientation === 'landscape' ? 'landscape' : 'portrait',
    page_size: doc.pageSize ?? null,
    page_w: doc.pageW ?? null,
    page_h: doc.pageH ?? null,
    custom_margins: doc.customMargins ?? null,
    header_text: doc.headerText ?? null,
    footer_text: doc.footerText ?? null,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
    deleted_at: doc.deletedAt ?? null,
    content_hash: contentHashOf(doc.content),
  }
}

/**
 * Hash of the FULL sync payload (content + every synced metadata field).
 * This is the dirty-check hash stored on the local doc as cloudHash at ack
 * time: any later change to content OR synced metadata changes it.
 */
export function payloadHashOf(doc: VyroDoc): string {
  return hashCanonicalString(stableStringify(docToPayload(doc)))
}

/**
 * Rebuild a local VyroDoc from a server row, stamped as synced at the
 * row's revision. The row passes through sanitizeDoc so a malformed
 * server value degrades exactly like a malformed local one.
 */
export function rowToDoc(row: CloudDocRow): VyroDoc {
  const clean = sanitizeDoc({
    id: row.id,
    title: row.title,
    content: row.content,
    html: row.html ?? undefined,
    folder: row.folder ?? '',
    favorite: !!row.favorite,
    dir: row.dir,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    templateId: row.template_id ?? undefined,
    margins: row.margins ?? undefined,
    orientation: row.orientation ?? undefined,
    pageSize: row.page_size ?? undefined,
    pageW: row.page_w ?? undefined,
    pageH: row.page_h ?? undefined,
    customMargins: row.custom_margins ?? undefined,
    headerText: row.header_text ?? undefined,
    footerText: row.footer_text ?? undefined,
    deletedAt: row.deleted_at ?? undefined,
  })
  // sanitizeDoc can only fail on a missing id/content; a server row always
  // has both (NOT NULL columns). Fall back to a minimal shell if it ever
  // did fail, so a pull can never crash the dashboard.
  const doc: VyroDoc = clean ?? {
    id: row.id, title: typeof row.title === 'string' ? row.title : 'Untitled',
    content: row.content, folder: '', favorite: false, dir: 'ltr',
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
  doc.cloudRevision = row.revision
  doc.cloudHash = payloadHashOf(doc)
  doc.cloudSyncedAt = row.server_updated_at
  return doc
}

// ---------------------------------------------------------------------------
// Outbox ops

export type SyncOpType = 'insert' | 'update' | 'delete'

export interface SyncOp {
  accountId: string
  docId: string
  op: SyncOpType
  /** Server revision this op is based on; 0 = the doc is not on the server yet. */
  baseRevision: number
  /** payloadHashOf the doc at enqueue time (informational; execution re-reads the doc). */
  payloadHash: string
  /** ISO enqueue time; also part of the op's identity for ack removal. */
  queuedAt: string
}

function sameDoc(a: SyncOp, b: SyncOp): boolean {
  return a.accountId === b.accountId && a.docId === b.docId
}

/**
 * Fold an incoming op into the LAST pending op for the same account+doc.
 * Returns the replacement for `last`, null when both cancel out, or
 * 'keep-both' when the pair must stay ordered (a pending hard delete
 * followed by a fresh insert/update — collapsing those would change
 * meaning, so the queue keeps both, in order).
 */
function foldPair(last: SyncOp, incoming: SyncOp): SyncOp | null | 'keep-both' {
  const latest = { payloadHash: incoming.payloadHash, queuedAt: incoming.queuedAt }
  switch (last.op) {
    case 'insert':
      if (incoming.op === 'delete') return null // never reached the server: both vanish
      // insert absorbs updates (execution re-reads the doc) and re-inserts.
      return { ...last, ...latest }
    case 'update':
      if (incoming.op === 'delete') return { ...incoming, baseRevision: last.baseRevision }
      // update+update / update+insert: one update on the EARLIEST base —
      // execution re-reads the current doc, so the newest intent wins
      // while the revision predicate still targets the true server base.
      return { ...last, op: 'update', ...latest }
    case 'delete':
      if (incoming.op === 'delete') return { ...last, ...latest }
      return 'keep-both'
  }
}

/**
 * Append an op to the queue with per-document collapsing (see foldPair).
 * Ops for other accounts/documents are never touched, and the surviving
 * op keeps its original queue position (FIFO order is queue order).
 * Never mutates the input.
 */
export function collapseOps(queue: SyncOp[], incoming: SyncOp): SyncOp[] {
  let lastIdx = -1
  for (let i = queue.length - 1; i >= 0; i--) if (sameDoc(queue[i], incoming)) { lastIdx = i; break }
  if (lastIdx === -1) return [...queue, incoming]
  const folded = foldPair(queue[lastIdx], incoming)
  if (folded === 'keep-both') return [...queue, incoming]
  const next = [...queue]
  if (folded === null) next.splice(lastIdx, 1)
  else next[lastIdx] = folded
  return next
}

/**
 * Remove the pending op an ack/drop refers to (ack path only). Matching
 * is on (accountId, docId, op, baseRevision) — deliberately NOT queuedAt:
 * if the user edits again while a write is in flight, the doc-change
 * effect re-enqueues and the fold REWRITES the queued op's queuedAt, so
 * an exact-timestamp match would miss and the already-acked op would be
 * re-driven (a duplicate insert → false conflict). Collapsing guarantees
 * at most one op per (account, doc, op-kind) pair can be pending in the
 * position this targets, so the match is unambiguous.
 */
export function removeMatchingOp(queue: SyncOp[], target: SyncOp): SyncOp[] {
  const idx = queue.findIndex((o) =>
    o.accountId === target.accountId && o.docId === target.docId && o.op === target.op
    && o.baseRevision === target.baseRevision)
  if (idx === -1) return queue
  const next = [...queue]
  next.splice(idx, 1)
  return next
}

/** This account's ops, in execution (FIFO) order. */
export function opsForAccount(queue: SyncOp[], accountId: string): SyncOp[] {
  return queue.filter((o) => o.accountId === accountId)
}

/** Pending ops for one document of one account, in execution order. */
export function pendingOpsFor(queue: SyncOp[], accountId: string, docId: string): SyncOp[] {
  return queue.filter((o) => o.accountId === accountId && o.docId === docId)
}

// ---------------------------------------------------------------------------
// Backoff: 1s, 2s, 4s, … capped at 30s, ±20% jitter. `attempt` is the
// count of consecutive failures so far (0 = first retry). The random
// source is injectable so tests are deterministic.

export const BACKOFF_BASE_MS = 1000
export const BACKOFF_MAX_MS = 30000

export function backoffDelayMs(attempt: number, rand: () => number = Math.random): number {
  const a = Math.max(0, Math.floor(attempt))
  const capped = Math.min(BACKOFF_BASE_MS * 2 ** a, BACKOFF_MAX_MS)
  const r = Math.min(1, Math.max(0, rand()))
  return Math.round(capped * (0.8 + r * 0.4))
}

// ---------------------------------------------------------------------------
// Ack / conflict classification

export type UpdateAck =
  | { kind: 'synced'; newRevision: number }
  | { kind: 'stale' }

/**
 * Classify the rows returned by a revision-predicated update
 * (.eq('revision', base) + .select()). Exactly one row at base+1 is the
 * only true ack (the DB trigger enforces exactly +1). Zero rows means the
 * predicate matched nothing — stale base, RLS refusal, or a gone row;
 * the caller disambiguates with classifyZeroRowUpdate after a re-read.
 */
export function classifyUpdateAck(returnedRevisions: number[], baseRevision: number): UpdateAck {
  if (returnedRevisions.length === 1) {
    const r = returnedRevisions[0]
    if (r === baseRevision + 1) return { kind: 'synced', newRevision: r }
    if (r > baseRevision) return { kind: 'synced', newRevision: r }
  }
  return { kind: 'stale' }
}

/**
 * A predicated update matched zero rows. Decide why, from a fresh read of
 * the server row:
 * - server copy gone (null)        → 'conflict' (never resurrect silently)
 * - server revision moved          → 'conflict' (another writer won)
 * - server revision still our base → 'rejected' (the row is exactly where
 *   we based the write, yet the write was refused: RLS/premium block —
 *   pause the queue, keep the op, per the plan's expiry behaviour)
 */
export function classifyZeroRowUpdate(serverRevision: number | null, baseRevision: number): 'conflict' | 'rejected' {
  if (serverRevision === null) return 'conflict'
  if (serverRevision !== baseRevision) return 'conflict'
  return 'rejected'
}

/**
 * An insert hit an existing server row (same id). If the server's payload
 * hash equals ours, the row is already exactly what we wanted to write —
 * adopt its revision as the ack. Anything else is a conflict: two writers
 * created the same id with different content, and neither may overwrite.
 */
export function classifyInsertConflict(serverPayloadHash: string | null, localPayloadHash: string): 'adopt' | 'conflict' {
  return serverPayloadHash !== null && serverPayloadHash === localPayloadHash ? 'adopt' : 'conflict'
}

// ---------------------------------------------------------------------------
// Per-document sync status

export type DocSyncStatus = 'local-only' | 'queued' | 'syncing' | 'synced' | 'conflict' | 'failed'

export interface DocSyncInputs {
  /** The doc has a server link (a cloudRevision) or pending cloud intent. */
  linked: boolean
  /** Current payload hash differs from the hash at the last ack. */
  dirty: boolean
  /** Pending outbox ops for this doc. */
  pendingOps: number
  /** An op for this doc is executing right now. */
  inFlight: boolean
  /** The last attempt for this doc failed (op kept, retry scheduled/paused). */
  failed: boolean
  /** A conflict was recorded and is waiting for the user (Stage 2C). */
  conflicted: boolean
}

export function deriveDocSyncStatus(i: DocSyncInputs): DocSyncStatus {
  if (i.conflicted) return 'conflict'
  if (i.inFlight) return 'syncing'
  if (i.pendingOps > 0) return i.failed ? 'failed' : 'queued'
  if (!i.linked) return 'local-only'
  return i.dirty ? 'queued' : 'synced'
}

// ---------------------------------------------------------------------------
// Pull-merge planning (refetch-on-focus, Stage 2 plan §2/§4).
//
// Pure decision over (local docs, server metadata). It NEVER plans an
// overwrite of a locally-dirty document: a newer server revision meeting
// unsynced local edits is a 'conflict' (record + snapshot locally; the
// user resolves it in 2C). Local-only documents (no server row) produce
// NO action — a pull never uploads anything.

export type PullAction =
  | { kind: 'adopt'; docId: string }
  | { kind: 'update-local'; docId: string }
  | { kind: 'link'; docId: string; revision: number }
  | { kind: 'conflict'; docId: string }
  | { kind: 'ignore'; docId: string }

export function planPullMerge(localDocs: VyroDoc[], serverMeta: CloudDocMeta[]): PullAction[] {
  const byId = new Map(localDocs.map((d) => [d.id, d]))
  const actions: PullAction[] = []
  for (const meta of serverMeta) {
    const local = byId.get(meta.id)
    if (!local) { actions.push({ kind: 'adopt', docId: meta.id }); continue }
    if (local.cloudConflict) { actions.push({ kind: 'ignore', docId: meta.id }); continue }
    const base = local.cloudRevision ?? 0
    if (meta.revision <= base) {
      // Server at (or behind) the revision we last acked: nothing to
      // pull. (Local dirt, if any, is a push concern, not a pull one.)
      actions.push({ kind: 'ignore', docId: meta.id })
      continue
    }
    // Server is newer than our last ack (or we never linked).
    const localClean = local.cloudRevision != null
      && !!local.cloudHash && payloadHashOf(local) === local.cloudHash
    if (localClean) { actions.push({ kind: 'update-local', docId: meta.id }); continue }
    if (contentHashOf(local.content) === meta.content_hash) {
      // Identical content on both sides (e.g. the same doc reached the
      // server from another device first): safe to link. The engine
      // stamps the server revision and a hash built from the SERVER's
      // metadata + this content, so any metadata difference still
      // surfaces as dirty and pushes as a normal update afterwards.
      actions.push({ kind: 'link', docId: meta.id, revision: meta.revision })
      continue
    }
    actions.push({ kind: 'conflict', docId: meta.id })
  }
  return actions
}
