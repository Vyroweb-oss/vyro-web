// Crash recovery for M2-04 (owner spec §21).
//
// Model: while the user types, the editor writes its latest pending JSON to
// a SEPARATE draft key (DRAFT_KEY). A confirmed save clears that doc's draft
// (see Editor: a draft identical to the saved doc is also cleared silently
// on open, so a normal save-then-reopen never shows a stale notice).
// Safety invariants, all enforced here:
// - A draft is NEVER applied automatically. detectRecovery() only reports.
// - A draft is never applied over a healthy saved doc without first
//   snapshotting the saved version (acceptDraft() creates a 'pre-restore'
//   backup via versions.ts).
// - Corrupt drafts (unparseable, wrong shape, wrong doc) are rejected, not
//   applied, and detection reports no recovery for them.
// - Storage access never throws; failed writes return false.

import { createSnapshot, addVersion, isValidDocContent, snapshotToPlainText, type VersionSnapshot } from './versions'

export const DRAFT_KEY = 'vyro-web-draft-v1'

export interface DraftRecord {
  docId: string
  content: any // TipTap JSON from the editor (pending, not yet saved)
  title: string
  savedAt: string // ISO timestamp of the draft write
}

type StorageLike = Pick<Storage, 'getItem'> & Partial<Pick<Storage, 'setItem' | 'removeItem'>>

export function validateDraft(raw: any): DraftRecord | null {
  try {
    if (!raw || typeof raw !== 'object') return null
    if (typeof raw.docId !== 'string' || !raw.docId) return null
    if (!isValidDocContent(raw.content)) return null
    if (typeof raw.title !== 'string') return null
    if (typeof raw.savedAt !== 'string' || Number.isNaN(new Date(raw.savedAt).getTime())) return null
    return {
      docId: raw.docId,
      content: JSON.parse(JSON.stringify(raw.content)),
      title: raw.title,
      savedAt: raw.savedAt,
    }
  } catch {
    return null
  }
}

/** All drafts, keyed by doc id. Corrupt store => {} (load never writes, so corrupt data is never overwritten by reading). */
export function loadDrafts(storage: StorageLike): Record<string, DraftRecord> {
  let raw: string | null = null
  try { raw = storage.getItem(DRAFT_KEY) } catch { return {} }
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, DraftRecord> = {}
    for (const [k, v] of Object.entries(parsed)) {
      const d = validateDraft(v)
      if (d && d.docId === k) out[k] = d
    }
    return out
  } catch {
    return {}
  }
}

export function loadDraft(storage: StorageLike, docId: string): DraftRecord | null {
  return loadDrafts(storage)[docId] ?? null
}

/** Returns false (never throws) when the draft is invalid or the write fails; prior drafts stay intact. */
export function saveDraft(storage: StorageLike, draft: DraftRecord): boolean {
  const valid = validateDraft(draft)
  if (!valid) return false
  const all = loadDrafts(storage)
  all[valid.docId] = valid
  try {
    storage.setItem?.(DRAFT_KEY, JSON.stringify(all))
    return true
  } catch {
    return false
  }
}

/** Remove one doc's draft. Best-effort; returns false only when the write fails. Never throws. */
export function clearDraft(storage: StorageLike, docId: string): boolean {
  const all = loadDrafts(storage)
  if (!(docId in all)) return true
  delete all[docId]
  try {
    if (Object.keys(all).length === 0) storage.removeItem?.(DRAFT_KEY)
    else storage.setItem?.(DRAFT_KEY, JSON.stringify(all))
    return true
  } catch {
    return false
  }
}

export interface RecoveryInfo {
  draft: DraftRecord
  savedLength: number
  draftLength: number
  /** Short excerpt around the first differing character, for each side. Never the full document. */
  savedExcerpt: string
  draftExcerpt: string
}

function excerptAround(text: string, at: number): string {
  const start = Math.max(0, at - 30)
  const end = Math.min(text.length, at + 30)
  const piece = text.slice(start, end)
  return `${start > 0 ? '…' : ''}${piece}${end < text.length ? '…' : ''}`
}

/** Canonical JSON: object keys sorted recursively, so two structurally
 * equal documents compare equal even when their keys were inserted in a
 * different order (import / paste / sanitize round-trips do that). */
export function stableStringify(v: any): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']'
  const keys = Object.keys(v).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}'
}

/**
 * Compare a draft against the saved document. Returns null (no recovery)
 * when there is no draft, the draft is corrupt, or it belongs to another
 * doc — and, per the release-hardening policy (owner, 2026-10-31), also
 * when there is nothing genuinely recoverable:
 * - IDENTICAL content (canonical compare): nothing was lost. A title-only
 *   difference is NOT lost content — the saved title already won, and
 *   showing a "recovery" banner for it was the false-positive users hit.
 * - STALE draft: the draft's savedAt is strictly older than the saved
 *   document's updatedAt, i.e. a confirmed save landed AFTER the draft's
 *   last keystroke, so the draft is provably superseded. (A tie is NOT
 *   stale: with different content the banner still shows — a potentially
 *   recoverable draft is never silently dropped on ambiguous evidence.)
 * Otherwise returns the comparison for the user to decide — never an
 * instruction to overwrite.
 */
export function detectRecovery(
  saved: { id: string; title: string; content: any; updatedAt?: string },
  draft: DraftRecord | null,
): RecoveryInfo | null {
  if (!draft || validateDraft(draft) === null) return null
  if (draft.docId !== saved.id) return null
  if (!isValidDocContent(saved.content)) return null
  const sameContent = stableStringify(draft.content) === stableStringify(saved.content)
  if (sameContent) return null
  if (saved.updatedAt && draft.savedAt < saved.updatedAt) return null
  const savedText = snapshotToPlainText(saved.content)
  const draftText = snapshotToPlainText(draft.content)
  let at = 0
  while (at < savedText.length && at < draftText.length && savedText[at] === draftText[at]) at++
  return {
    draft,
    savedLength: savedText.length,
    draftLength: draftText.length,
    savedExcerpt: excerptAround(savedText, at),
    draftExcerpt: excerptAround(draftText, at),
  }
}

/**
 * Accept a draft: snapshot the CURRENT saved doc as a 'pre-restore' backup
 * first, then return the draft content/title to apply plus the new version
 * store. Returns null when the saved doc is invalid (nothing is changed).
 */
export function acceptDraft(
  saved: { id: string; title: string; content: any },
  draft: DraftRecord,
  versions: VersionSnapshot[],
): { backup: VersionSnapshot; restored: { content: any; title: string }; versions: VersionSnapshot[] } | null {
  if (validateDraft(draft) === null || draft.docId !== saved.id) return null
  const backup = createSnapshot(saved, 'pre-restore')
  if (!backup) return null
  return {
    backup,
    restored: { content: JSON.parse(JSON.stringify(draft.content)), title: draft.title },
    versions: addVersion(versions, backup),
  }
}
