// Stage 2D foundation — full-library backup bundle (build / serialize /
// parse / restore / verify), pure and storage-agnostic.
//
// Scope (owner's Stage 2D order): the backup covers the DOCUMENT LIBRARY —
// documents (including trashed ones), their version-history snapshots and
// the crash-recovery drafts. It does NOT cover app settings, and it never
// touches the cloud: nothing here uploads, deletes or rewrites anything.
//
// Design rules:
// - Building a backup never mutates its inputs (deep copies throughout).
// - Cloud bookkeeping is NOT stored inside the backed-up documents. A doc's
//   cloud link (revision + hash) is recorded in a separate `cloudLinks`
//   manifest, and restored documents always come back WITHOUT cloud fields
//   (local-only). Re-applying a link requires verifying the server row
//   still matches the recorded hash — that is a later sync-stage concern,
//   not something a file restore may silently assume.
// - Parsing is all-or-nothing at the structure level: a truncated or
//   malformed bundle yields a typed error and NO partial library, so an
//   interrupted write can never restore half a library. Individually
//   invalid entries inside otherwise well-formed arrays are dropped and
//   COUNTED in the result — never silently, never fatal.
// - Every entry is re-validated through the same validators the live
//   stores use (sanitizeDoc / validateSnapshot / validateDraft), so a
//   restored library is exactly what a normal app load would produce.
// - Counts in the file are advisory only; parse recomputes them from the
//   actual arrays.

import type { VyroDoc } from './types'
import { sanitizeDoc } from './store'
import { validateSnapshot, type VersionSnapshot } from './versions'
import { validateDraft, type DraftRecord } from './recovery'
import { contentHashOf } from './syncProtocol'

export const LIBRARY_BACKUP_KIND = 'vyro-library-backup'
export const LIBRARY_BACKUP_FORMAT_VERSION = 1

/** A document's cloud link, recorded OUTSIDE the document itself. */
export interface CloudLinkRecord {
  docId: string
  cloudRevision: number
  cloudHash: string
  cloudSyncedAt?: string
}

export interface LibraryBackup {
  kind: typeof LIBRARY_BACKUP_KIND
  formatVersion: number
  exportedAt: string
  counts: { documents: number; versions: number; drafts: number }
  /** Documents with cloud fields stripped (links live in cloudLinks). */
  documents: VyroDoc[]
  versions: VersionSnapshot[]
  drafts: Record<string, DraftRecord>
  cloudLinks: CloudLinkRecord[]
}

export interface LibraryState {
  docs: VyroDoc[]
  versions: VersionSnapshot[]
  drafts: Record<string, DraftRecord>
}

function deepCopy<T>(v: T): T {
  return v === undefined ? v : JSON.parse(JSON.stringify(v))
}

function stripCloudFields(doc: VyroDoc): VyroDoc {
  const copy = deepCopy(doc)
  delete copy.cloudRevision
  delete copy.cloudHash
  delete copy.cloudSyncedAt
  delete copy.cloudConflict
  return copy
}

// ---------------------------------------------------------------------------
// Build + serialize
// ---------------------------------------------------------------------------

export function buildLibraryBackup(state: LibraryState, now: Date = new Date()): LibraryBackup {
  const cloudLinks: CloudLinkRecord[] = []
  const documents = state.docs.map((doc) => {
    if (typeof doc.cloudRevision === 'number' && typeof doc.cloudHash === 'string' && doc.cloudHash) {
      cloudLinks.push({
        docId: doc.id,
        cloudRevision: doc.cloudRevision,
        cloudHash: doc.cloudHash,
        cloudSyncedAt: typeof doc.cloudSyncedAt === 'string' ? doc.cloudSyncedAt : undefined,
      })
    }
    return stripCloudFields(doc)
  })
  const versions = deepCopy(state.versions)
  const drafts = deepCopy(state.drafts)
  return {
    kind: LIBRARY_BACKUP_KIND,
    formatVersion: LIBRARY_BACKUP_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    counts: { documents: documents.length, versions: versions.length, drafts: Object.keys(drafts).length },
    documents,
    versions,
    drafts,
    cloudLinks,
  }
}

export function serializeLibraryBackup(backup: LibraryBackup): string {
  return JSON.stringify(backup)
}

// ---------------------------------------------------------------------------
// Parse (strict structure, per-entry validation, counted drops)
// ---------------------------------------------------------------------------

export type LibraryBackupParseError =
  | 'not-json'
  | 'wrong-kind'
  | 'unsupported-version'
  | 'bad-shape'

export interface ParsedLibraryBackup {
  backup: LibraryBackup
  droppedDocuments: number
  droppedVersions: number
  droppedDrafts: number
  droppedCloudLinks: number
}

export type LibraryBackupParseResult =
  | { ok: true; value: ParsedLibraryBackup }
  | { ok: false; error: LibraryBackupParseError }

function validateCloudLink(raw: any): CloudLinkRecord | null {
  if (!raw || typeof raw !== 'object') return null
  if (typeof raw.docId !== 'string' || !raw.docId) return null
  if (typeof raw.cloudRevision !== 'number' || !Number.isFinite(raw.cloudRevision) || raw.cloudRevision < 1) return null
  if (typeof raw.cloudHash !== 'string' || !raw.cloudHash) return null
  return {
    docId: raw.docId,
    cloudRevision: Math.floor(raw.cloudRevision),
    cloudHash: raw.cloudHash,
    cloudSyncedAt: typeof raw.cloudSyncedAt === 'string' && raw.cloudSyncedAt ? raw.cloudSyncedAt : undefined,
  }
}

export function parseLibraryBackup(text: string): LibraryBackupParseResult {
  let raw: any
  try {
    raw = JSON.parse(text)
  } catch {
    // Covers truncated / half-written files: an interrupted write is never
    // valid JSON, so it can never produce a partial restore.
    return { ok: false, error: 'not-json' }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'bad-shape' }
  if (raw.kind !== LIBRARY_BACKUP_KIND) return { ok: false, error: 'wrong-kind' }
  if (raw.formatVersion !== LIBRARY_BACKUP_FORMAT_VERSION) return { ok: false, error: 'unsupported-version' }
  if (!Array.isArray(raw.documents) || !Array.isArray(raw.versions)) return { ok: false, error: 'bad-shape' }
  if (!raw.drafts || typeof raw.drafts !== 'object' || Array.isArray(raw.drafts)) return { ok: false, error: 'bad-shape' }
  if (raw.cloudLinks !== undefined && !Array.isArray(raw.cloudLinks)) return { ok: false, error: 'bad-shape' }

  let droppedDocuments = 0
  const documents: VyroDoc[] = []
  for (const entry of raw.documents) {
    const doc = sanitizeDoc(entry)
    if (!doc) { droppedDocuments++; continue }
    // Defense in depth: even a foreign/hand-edited bundle may not smuggle
    // cloud bookkeeping back into a restored document.
    documents.push(stripCloudFields(doc))
  }

  let droppedVersions = 0
  const versions: VersionSnapshot[] = []
  for (const entry of raw.versions) {
    const snap = validateSnapshot(entry)
    if (!snap) { droppedVersions++; continue }
    versions.push(snap)
  }

  let droppedDrafts = 0
  const drafts: Record<string, DraftRecord> = {}
  for (const [key, entry] of Object.entries(raw.drafts)) {
    const draft = validateDraft(entry)
    if (!draft || draft.docId !== key) { droppedDrafts++; continue }
    drafts[key] = draft
  }

  let droppedCloudLinks = 0
  const cloudLinks: CloudLinkRecord[] = []
  for (const entry of Array.isArray(raw.cloudLinks) ? raw.cloudLinks : []) {
    const link = validateCloudLink(entry)
    if (!link) { droppedCloudLinks++; continue }
    cloudLinks.push(link)
  }

  const backup: LibraryBackup = {
    kind: LIBRARY_BACKUP_KIND,
    formatVersion: LIBRARY_BACKUP_FORMAT_VERSION,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
    counts: {
      documents: documents.length,
      versions: versions.length,
      drafts: Object.keys(drafts).length,
    },
    documents,
    versions,
    drafts,
    cloudLinks,
  }
  return { ok: true, value: { backup, droppedDocuments, droppedVersions, droppedDrafts, droppedCloudLinks } }
}

// ---------------------------------------------------------------------------
// Restore (pure: returns the library state; applies NO cloud links)
// ---------------------------------------------------------------------------

export interface RestoredLibrary {
  documents: VyroDoc[]
  versions: VersionSnapshot[]
  drafts: Record<string, DraftRecord>
  /** Recorded cloud links, returned for later verified re-linking only. */
  cloudLinks: CloudLinkRecord[]
}

export function restoreLibrary(parsed: ParsedLibraryBackup): RestoredLibrary {
  return {
    documents: deepCopy(parsed.backup.documents),
    versions: deepCopy(parsed.backup.versions),
    drafts: deepCopy(parsed.backup.drafts),
    cloudLinks: deepCopy(parsed.backup.cloudLinks),
  }
}

// ---------------------------------------------------------------------------
// Verify a restored library against the original it was backed up from
// ---------------------------------------------------------------------------

export interface LibraryVerification {
  documentsChecked: number
  documentsIdentical: number
  versionsChecked: number
  versionsIdentical: number
  draftsChecked: number
  draftsIdentical: number
  /** Ids present in the original but missing or different after restore. */
  mismatchedDocIds: string[]
  mismatchedVersionIds: string[]
  mismatchedDraftIds: string[]
}

function docFingerprint(doc: VyroDoc): string {
  return [
    contentHashOf(doc.content),
    doc.title,
    doc.dir,
    doc.deletedAt ?? '',
    doc.folder ?? '',
    doc.favorite ? '1' : '0',
  ].join('|')
}

function versionFingerprint(snap: VersionSnapshot): string {
  return [contentHashOf(snap.content), snap.title, snap.trigger, snap.label ?? ''].join('|')
}

function draftFingerprint(draft: DraftRecord): string {
  return [contentHashOf(draft.content), draft.title, draft.savedAt].join('|')
}

export function verifyRestoredLibrary(original: LibraryState, restored: RestoredLibrary): LibraryVerification {
  const restoredDocs = new Map(restored.documents.map((d) => [d.id, d]))
  const mismatchedDocIds: string[] = []
  let documentsIdentical = 0
  for (const doc of original.docs) {
    const back = restoredDocs.get(doc.id)
    if (back && docFingerprint(back) === docFingerprint(doc)) documentsIdentical++
    else mismatchedDocIds.push(doc.id)
  }

  const restoredVersions = new Map(restored.versions.map((v) => [v.id, v]))
  const mismatchedVersionIds: string[] = []
  let versionsIdentical = 0
  for (const snap of original.versions) {
    const back = restoredVersions.get(snap.id)
    if (back && versionFingerprint(back) === versionFingerprint(snap)) versionsIdentical++
    else mismatchedVersionIds.push(snap.id)
  }

  const mismatchedDraftIds: string[] = []
  let draftsIdentical = 0
  const originalDraftIds = Object.keys(original.drafts)
  for (const id of originalDraftIds) {
    const back = restored.drafts[id]
    if (back && draftFingerprint(back) === draftFingerprint(original.drafts[id])) draftsIdentical++
    else mismatchedDraftIds.push(id)
  }

  return {
    documentsChecked: original.docs.length,
    documentsIdentical,
    versionsChecked: original.versions.length,
    versionsIdentical,
    draftsChecked: originalDraftIds.length,
    draftsIdentical,
    mismatchedDocIds,
    mismatchedVersionIds,
    mismatchedDraftIds,
  }
}
