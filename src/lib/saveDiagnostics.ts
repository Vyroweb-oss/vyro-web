// Autosave diagnostics for M2-13 (owner spec §15).
//
// The honesty gap this closes: the editor used to label a flush 'saved'
// the moment it handed JSON to onChange, BEFORE the parent actually
// wrote to browser storage. This module is the pure, testable half of
// the fix: a diagnostics record whose transitions never claim success
// without confirmation, plus a best-effort single-document local backup.
//
// Privacy rule: a diagnostics record NEVER contains document text — only
// a status, timestamps, counts and an error kind. The backup snapshot
// itself is document content, so it lives under its own key and is only
// ever written locally, never sent anywhere.

export type SaveDiagStatus = 'saved' | 'saving' | 'pending' | 'failed'
export type SaveErrorKind = 'quota' | 'storage' | 'unknown'

export interface SaveDiagnostics {
  status: SaveDiagStatus
  /** ISO timestamp of the last CONFIRMED successful write, or null when no save has ever been confirmed. */
  lastSuccessAt: string | null
  /** ISO timestamp of the last write attempt (hand-off to the parent), or null when none has been attempted. */
  lastAttemptAt: string | null
  /** Total failed attempts recorded. Never reset by a later success — it is a count, not a streak. */
  failureCount: number
  /** Kind of the most recent failure, or null when the last confirmed outcome was a success (or none yet). */
  lastErrorKind: SaveErrorKind | null
  /** ISO timestamp of the local backup snapshot, or null when none exists. Mirrors the backup key; kept here for display. */
  backupAt: string | null
  /** Doc id the backup snapshot belongs to, or null when none exists. */
  backupDocId: string | null
}

export function initialSaveDiag(): SaveDiagnostics {
  return {
    status: 'saved',
    lastSuccessAt: null,
    lastAttemptAt: null,
    failureCount: 0,
    lastErrorKind: null,
    backupAt: null,
    backupDocId: null,
  }
}

/** A write attempt was handed off. Claims nothing about the outcome. */
export function recordAttempt(prev: SaveDiagnostics, at: string): SaveDiagnostics {
  return { ...prev, status: 'saving', lastAttemptAt: at }
}

/**
 * A write was CONFIRMED (the parent's storage effect succeeded and the
 * document's updatedAt moved while no failure was reported). This is the
 * ONLY transition that sets lastSuccessAt.
 */
export function recordSuccess(prev: SaveDiagnostics, at: string): SaveDiagnostics {
  return { ...prev, status: 'saved', lastSuccessAt: at, lastErrorKind: null }
}

/**
 * A write FAILED. lastSuccessAt is NEVER overwritten here — a failed
 * attempt must not erase the memory of the last good save. The record
 * carries no document text, only the kind, the time and the counts.
 */
export function recordFailure(prev: SaveDiagnostics, kind: SaveErrorKind, at: string): SaveDiagnostics {
  return {
    ...prev,
    status: 'failed',
    lastAttemptAt: at,
    failureCount: prev.failureCount + 1,
    lastErrorKind: kind,
  }
}

/** Attach (or clear, with nulls) the local-backup mirror fields. Pure; touches no storage. */
export function withBackup(prev: SaveDiagnostics, backup: { savedAt: string; docId: string } | null): SaveDiagnostics {
  return {
    ...prev,
    backupAt: backup ? backup.savedAt : null,
    backupDocId: backup ? backup.docId : null,
  }
}

/**
 * Classify a storage failure by error name/message. Quota wording wins
 * over storage wording (a full store is the actionable case); anything
 * else — including null, undefined and empty values — is 'unknown'.
 * The returned kind is all the diagnostics record ever stores about an
 * error; the original message (which could quote document text) is
 * deliberately discarded.
 */
export function classifyError(err: unknown): SaveErrorKind {
  const name = err instanceof Error ? err.name : (err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '')
  const message = err instanceof Error ? err.message : (typeof err === 'string' ? err : (err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : ''))
  if (name === 'QuotaExceededError' || /quota/i.test(message)) return 'quota'
  if (name === 'SecurityError' || /storage|security/i.test(message)) return 'storage'
  return 'unknown'
}

export const SAVE_BACKUP_KEY = 'vyro-web-save-backup-v1'

export interface SaveBackup {
  docId: string
  title: string
  content: any // TipTap JSON snapshot of one document
  savedAt: string // ISO timestamp of the snapshot
}

type StorageLike = Pick<Storage, 'getItem'> & Partial<Pick<Storage, 'setItem' | 'removeItem'>>

function validateBackup(raw: any): SaveBackup | null {
  try {
    if (!raw || typeof raw !== 'object') return null
    if (typeof raw.docId !== 'string' || !raw.docId) return null
    if (typeof raw.title !== 'string') return null
    if (typeof raw.savedAt !== 'string' || Number.isNaN(new Date(raw.savedAt).getTime())) return null
    if (!raw.content || typeof raw.content !== 'object') return null
    return {
      docId: raw.docId,
      title: raw.title,
      // Deep copy so later editor edits never mutate the stored snapshot.
      content: JSON.parse(JSON.stringify(raw.content)),
      savedAt: raw.savedAt,
    }
  } catch {
    return null
  }
}

/**
 * Store a single-document backup snapshot (overwrites any previous one).
 * Best-effort: returns false, never throws, when the snapshot is invalid
 * or the write fails. The snapshot stays in this browser only.
 */
export function saveBackup(storage: StorageLike, backup: SaveBackup): boolean {
  const valid = validateBackup(backup)
  if (!valid) return false
  try {
    storage.setItem?.(SAVE_BACKUP_KEY, JSON.stringify(valid))
    return true
  } catch {
    return false
  }
}

/** Load the backup snapshot, or null when none exists or it is corrupt (a corrupt entry is never overwritten by reading). */
export function loadBackup(storage: StorageLike): SaveBackup | null {
  let raw: string | null = null
  try { raw = storage.getItem(SAVE_BACKUP_KEY) } catch { return null }
  if (!raw) return null
  try { return validateBackup(JSON.parse(raw)) } catch { return null }
}

/** Remove the backup snapshot. Best-effort; returns false only when the removal fails. Never throws. */
export function clearBackup(storage: StorageLike): boolean {
  try {
    storage.removeItem?.(SAVE_BACKUP_KEY)
    return true
  } catch {
    return false
  }
}

/**
 * Where documents are stored. The app is Local Mode: pass false until a
 * real cloud connection exists — never invent one. True would mean a
 * configured, connected cloud store (not currently the case).
 */
export function storageLocation(cloudConfigured: boolean): 'local' | 'cloud' {
  return cloudConfigured ? 'cloud' : 'local'
}
