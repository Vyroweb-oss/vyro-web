// Version history for M2-04 (owner spec §8) + shared plain-text helper.
//
// Design rules (all enforced here, not in the UI):
// - Versions live under their OWN storage key (VERSIONS_KEY). The docs store
//   (vyro-web-docs-v1) is never touched by this module.
// - Snapshots are deep copies: later edits can never mutate a saved version.
// - Storage access never throws: every load/save returns a plain result and
//   a failed write leaves previously stored data untouched (a throwing
//   setItem simply never replaces it; an invalid payload is refused before
//   any write, so corrupt input can never overwrite a healthy store).
// - Pruning protects named (labelled) snapshots: only unlabelled auto
//   snapshots are pruned, oldest first, and only until the caps are met.
// - Restore NEVER overwrites silently: restoreVersion() always inserts a
//   'pre-restore' backup of the current document first.

import { uid } from './types'

export const VERSIONS_KEY = 'vyro-web-versions-v1'

export type VersionTrigger =
  | 'manual'
  | 'auto'
  | 'before-replace'
  | 'before-import'
  | 'before-risky'
  | 'pre-restore'
  | 'recovery'

export const VERSION_TRIGGERS: VersionTrigger[] = [
  'manual', 'auto', 'before-replace', 'before-import', 'before-risky', 'pre-restore', 'recovery',
]

export interface VersionSnapshot {
  id: string
  docId: string
  createdAt: string // ISO timestamp
  label?: string
  trigger: VersionTrigger
  content: any // TipTap JSON, deep-copied at creation
  title: string
}

export interface PruneOptions {
  /** Max snapshots kept per document (default 20). Named snapshots are exempt. */
  maxCount?: number
  /** Max total bytes (JSON length) across ALL stored snapshots (default 5 MiB). */
  maxTotalBytes?: number
}

export const DEFAULT_MAX_COUNT = 20
export const DEFAULT_MAX_TOTAL_BYTES = 5 * 1024 * 1024

function deepCopy<T>(v: T): T {
  return v === undefined ? v : JSON.parse(JSON.stringify(v))
}

/** A TipTap document JSON: { type: 'doc', content: [...] }. Anything else is not a restorable document. */
export function isValidDocContent(content: any): boolean {
  return !!content && typeof content === 'object' && !Array.isArray(content)
    && content.type === 'doc' && Array.isArray(content.content)
}

/** Validate one stored snapshot record; returns the cleaned record or null. Never throws. */
export function validateSnapshot(raw: any): VersionSnapshot | null {
  try {
    if (!raw || typeof raw !== 'object') return null
    if (typeof raw.id !== 'string' || !raw.id) return null
    if (typeof raw.docId !== 'string' || !raw.docId) return null
    if (typeof raw.createdAt !== 'string' || Number.isNaN(new Date(raw.createdAt).getTime())) return null
    if (!VERSION_TRIGGERS.includes(raw.trigger)) return null
    if (!isValidDocContent(raw.content)) return null
    if (typeof raw.title !== 'string') return null
    return {
      id: raw.id,
      docId: raw.docId,
      createdAt: raw.createdAt,
      label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : undefined,
      trigger: raw.trigger,
      content: deepCopy(raw.content),
      title: raw.title,
    }
  } catch {
    return null
  }
}

export function createSnapshot(
  doc: { id: string; title: string; content: any },
  trigger: VersionTrigger,
  label?: string,
  createdAt?: string,
): VersionSnapshot | null {
  if (!doc || typeof doc.id !== 'string' || !doc.id) return null
  if (!isValidDocContent(doc.content)) return null
  const at = createdAt && !Number.isNaN(new Date(createdAt).getTime())
    ? createdAt : new Date().toISOString()
  return {
    id: uid(),
    docId: doc.id,
    createdAt: at,
    label: label && label.trim() ? label.trim() : undefined,
    trigger,
    content: deepCopy(doc.content),
    title: typeof doc.title === 'string' ? doc.title : 'Untitled',
  }
}

/** Snapshots for one document, newest first. Input order is preserved for equal timestamps (stable sort). */
export function listVersions(versions: VersionSnapshot[], docId: string): VersionSnapshot[] {
  return versions
    .filter((v) => v.docId === docId)
    .map((v, i) => ({ v, i }))
    .sort((a, b) => {
      const d = new Date(b.v.createdAt).getTime() - new Date(a.v.createdAt).getTime()
      return d !== 0 ? d : a.i - b.i
    })
    .map(({ v }) => v)
}

export function snapshotByteSize(snap: VersionSnapshot): number {
  try { return JSON.stringify(snap).length } catch { return 0 }
}

/**
 * Enforce the caps. Per document, unlabelled snapshots are dropped oldest
 * first until at most maxCount remain (named snapshots never count against
 * the cap and are never pruned here); then, if the whole store still
 * exceeds maxTotalBytes, unlabelled snapshots are dropped oldest-first
 * across all documents. Returns a new array; never mutates the input.
 * If every snapshot is named and the byte cap is still exceeded, the store
 * is returned unchanged — pruning must not delete a user's named versions
 * to satisfy a byte budget ("protected where feasible": with nothing
 * prunable, nothing is pruned, and the caller still holds valid data).
 */
export function pruneVersions(versions: VersionSnapshot[], opts: PruneOptions = {}): VersionSnapshot[] {
  const maxCount = opts.maxCount ?? DEFAULT_MAX_COUNT
  const maxTotalBytes = opts.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES
  let out = [...versions]
  // Per-document count cap (unlabelled only).
  const byDoc = new Map<string, VersionSnapshot[]>()
  for (const v of out) {
    const arr = byDoc.get(v.docId) ?? []
    arr.push(v)
    byDoc.set(v.docId, arr)
  }
  const keep = new Set<string>()
  for (const arr of byDoc.values()) {
    const unlabelled = arr.filter((v) => !v.label)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    const allowed = new Set(unlabelled.slice(0, Math.max(0, maxCount)).map((v) => v.id))
    for (const v of arr) if (v.label || allowed.has(v.id)) keep.add(v.id)
  }
  out = out.filter((v) => keep.has(v.id))
  // Total byte cap (unlabelled, oldest first, across all docs).
  let total = out.reduce((n, v) => n + snapshotByteSize(v), 0)
  if (total > maxTotalBytes) {
    const prunable = out.filter((v) => !v.label)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    const drop = new Set<string>()
    for (const v of prunable) {
      if (total <= maxTotalBytes) break
      drop.add(v.id)
      total -= snapshotByteSize(v)
    }
    out = out.filter((v) => !drop.has(v.id))
  }
  return out
}

/** Add a snapshot, then enforce caps. Returns the new store (input untouched). */
export function addVersion(
  versions: VersionSnapshot[],
  snap: VersionSnapshot,
  opts: PruneOptions = {},
): VersionSnapshot[] {
  return pruneVersions([...versions, snap], opts)
}

type StorageLike = Pick<Storage, 'getItem'> & Partial<Pick<Storage, 'setItem'>>

/**
 * Load the version store. Missing key, unreadable storage, unparseable JSON
 * or a non-array payload all yield [] — and load NEVER writes, so a corrupt
 * payload is never overwritten by the act of reading it. Individually
 * corrupt entries are dropped; healthy entries survive.
 */
export function loadVersions(storage: StorageLike): VersionSnapshot[] {
  let raw: string | null = null
  try { raw = storage.getItem(VERSIONS_KEY) } catch { return [] }
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(validateSnapshot).filter((v): v is VersionSnapshot => v !== null)
  } catch {
    return []
  }
}

/**
 * Persist the version store. Returns false (never throws) when any snapshot
 * is invalid or the write itself fails (e.g. QuotaExceededError). In both
 * cases nothing is written, so previously stored data stays intact.
 */
export function saveVersions(storage: Pick<Storage, 'setItem'>, versions: VersionSnapshot[]): boolean {
  if (versions.some((v) => validateSnapshot(v) === null)) return false
  try {
    storage.setItem(VERSIONS_KEY, JSON.stringify(versions))
    return true
  } catch {
    return false
  }
}

/**
 * Headless restore flow. Returns null when the version is missing or the
 * current document content is invalid (nothing is changed). Otherwise
 * returns the pre-restore backup snapshot, the content/title to apply, and
 * the new version store (backup inserted, caps enforced). The caller applies
 * `restored` to the document; the saved document itself is never touched here.
 */
export function restoreVersion(
  versions: VersionSnapshot[],
  doc: { id: string; title: string; content: any },
  versionId: string,
  opts: PruneOptions = {},
): { backup: VersionSnapshot; restored: { content: any; title: string }; versions: VersionSnapshot[] } | null {
  const target = versions.find((v) => v.id === versionId && v.docId === doc.id)
  if (!target || validateSnapshot(target) === null) return null
  const backup = createSnapshot(doc, 'pre-restore')
  if (!backup) return null
  return {
    backup,
    restored: { content: deepCopy(target.content), title: target.title },
    versions: addVersion(versions, backup, opts),
  }
}

/** Plain-text extraction for read-only previews (no HTML, no markup). */
export function snapshotToPlainText(content: any): string {
  let out = ''
  const rec = (n: any): void => {
    if (!n) return
    if (n.type === 'text') out += n.text || ''
    if (Array.isArray(n.content)) n.content.forEach(rec)
    if (['paragraph', 'heading', 'listItem'].includes(n.type)) out += '\n'
  }
  rec(content)
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Tier-1 S1: does this content hold anything worth protecting with a
 * version snapshot before a destructive replacement (DOCX/TXT import)?
 * True when any text node carries non-whitespace text, or the doc holds a
 * structural block whose loss matters even without text (image, table,
 * TOC, page break, rule). Pure and total — never throws on odd shapes.
 */
export function hasSnapshotWorthyContent(content: any): boolean {
  const STRUCTURAL = new Set(['image', 'table', 'tocBlock', 'pageBreak', 'horizontalRule'])
  let worthy = false
  const walk = (n: any): void => {
    if (worthy || !n || typeof n !== 'object') return
    if (n.type === 'text' && typeof n.text === 'string' && n.text.trim().length > 0) { worthy = true; return }
    if (typeof n.type === 'string' && STRUCTURAL.has(n.type)) { worthy = true; return }
    if (Array.isArray(n.content)) for (const c of n.content) walk(c)
  }
  walk(content)
  return worthy
}
