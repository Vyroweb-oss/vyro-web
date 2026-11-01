import type { VyroDoc } from './types'
import { uid } from './types'
export const STORAGE_KEY = 'vyro-web-docs-v1'
export const CORRUPT_BACKUP_KEY = 'vyro-web-docs-v1.corrupt-backup'
export const SORT_KEY = 'vyro-web-sort'
// Pure logic separated from React / localStorage for testability

function deepCopy<T>(v: T): T { return v === undefined ? v : JSON.parse(JSON.stringify(v)) }

export function createDoc(docs: VyroDoc[], partial: Partial<VyroDoc> & { title: string }): { docs: VyroDoc[]; doc: VyroDoc } {
  const now = new Date().toISOString()
  const doc: VyroDoc = { id: uid(), content: deepCopy(partial.content) ?? { type:'doc', content:[{type:'paragraph'}] }, folder: partial.folder ?? '', favorite: !!partial.favorite, dir: partial.dir ?? 'ltr', createdAt: now, updatedAt: now, margins: partial.margins ?? 'normal', orientation: partial.orientation ?? 'portrait', templateId: partial.templateId, html: partial.html, title: partial.title,
    // Tier-1 S4a: page-layout fields propagate from the partial when the
    // caller supplies them (Mail Merge passes the source document's), so a
    // created document keeps its intended page size / custom geometry /
    // custom margins / header / footer instead of silently reverting to
    // A4 defaults. Absent = undefined = the layout resolvers' defaults.
    pageSize: partial.pageSize, pageW: partial.pageW, pageH: partial.pageH, customMargins: partial.customMargins, headerText: partial.headerText, footerText: partial.footerText }
  return { docs: [doc, ...docs], doc }
}
export function updateDoc(docs: VyroDoc[], id: string, patch: Partial<VyroDoc>): VyroDoc[] {
  return docs.map(d => d.id===id ? { ...d, ...patch, updatedAt: new Date().toISOString() } : d)
}
export function renameDoc(docs: VyroDoc[], id: string, title: string): VyroDoc[] { return updateDoc(docs, id, { title: title.trim()||'Untitled' }) }
export function duplicateDoc(docs: VyroDoc[], id: string): VyroDoc[] {
  const src = docs.find(d=>d.id===id); if(!src) return docs
  const now = new Date().toISOString()
  // Deep-copy content/html so the copy can never share mutable TipTap JSON with the original.
  const copy: VyroDoc = { ...src, content: deepCopy(src.content), html: src.html, id: uid(), title: src.title+' (copy)', createdAt: now, updatedAt: now, deletedAt: undefined }
  return [copy, ...docs]
}
export function deleteDoc(docs: VyroDoc[], id: string): VyroDoc[] { return docs.filter(d=>d.id!==id) }
/** Move a doc to trash (soft delete). updatedAt is left untouched — trashing is not an edit. */
export function trashDoc(docs: VyroDoc[], id: string): VyroDoc[] {
  const now = new Date().toISOString()
  return docs.map(d => d.id===id ? { ...d, deletedAt: now } : d)
}
/** Restore a trashed doc back to the library. */
export function restoreDoc(docs: VyroDoc[], id: string): VyroDoc[] {
  return docs.map(d => d.id===id ? { ...d, deletedAt: undefined } : d)
}
/** Permanently remove a doc (same semantics as deleteDoc). */
export function purgeDoc(docs: VyroDoc[], id: string): VyroDoc[] { return deleteDoc(docs, id) }
/** Trashed docs only, most recently trashed first. */
export function listTrashed(docs: VyroDoc[]): VyroDoc[] {
  return docs.filter(d=>!!d.deletedAt).sort((a,b)=> (new Date(b.deletedAt!).getTime()||0)-(new Date(a.deletedAt!).getTime()||0))
}
export function toggleFavorite(docs: VyroDoc[], id: string): VyroDoc[] { const d=docs.find(x=>x.id===id); if(!d) return docs; return updateDoc(docs,id,{favorite:!d.favorite}) }

/** Normalise Arabic-keyboard variants so Dari/Persian search matches regardless of keyboard layout. */
export function normalizeSearchText(s: string): string {
  return (s||'').toLowerCase()
    .replace(/ي/g,'ی').replace(/ك/g,'ک')
    .replace(/ة/g,'ه').replace(/ؤ/g,'و').replace(/إ|أ/g,'ا')
    .replace(/[\u064B-\u0652\u0670]/g,'') // Arabic diacritics
    .trim()
}
export function searchDocs(docs: VyroDoc[], q: string): VyroDoc[] { const s=normalizeSearchText(q); if(!s) return docs; return docs.filter(d=> normalizeSearchText(d.title||'').includes(s)||normalizeSearchText(d.folder||'').includes(s)) }
export function filterDocs(docs: VyroDoc[], opts:{folder?:string; favoritesOnly?:boolean; query?:string}): VyroDoc[] {
  // Trashed docs are excluded from every dashboard list/search/count by default.
  let out=docs.filter(d=>!d.deletedAt); if(opts.query) out=searchDocs(out,opts.query); if(opts.favoritesOnly) out=out.filter(d=>d.favorite); if(opts.folder!==undefined && opts.folder!=='') out=out.filter(d=>d.folder===opts.folder); return sortRecent(out)
}
export function sortRecent(docs: VyroDoc[]): VyroDoc[] { return [...docs].sort((a,b)=> (new Date(b.updatedAt).getTime()||0)-(new Date(a.updatedAt).getTime()||0)) }
export type SortMode = 'updated' | 'name' | 'created'
function tsOf(s?: string): number | null { if(!s) return null; const n = new Date(s).getTime(); return Number.isFinite(n) ? n : null }
/** Pure dashboard sorting. 'updated' reproduces sortRecent exactly; 'name' uses locale-aware collation (Persian/Arabic titles included); 'created' falls back to updatedAt for legacy docs without createdAt. Never mutates the input. */
export function sortDocs(docs: VyroDoc[], mode: SortMode): VyroDoc[] {
  if (mode === 'name') {
    return [...docs].sort((a,b)=>{
      const c = (a.title||'').localeCompare(b.title||'', undefined, { sensitivity:'base' })
      return c !== 0 ? c : (tsOf(b.updatedAt)??0) - (tsOf(a.updatedAt)??0)
    })
  }
  if (mode === 'created') {
    return [...docs].sort((a,b)=> ((tsOf(b.createdAt) ?? tsOf(b.updatedAt) ?? 0) - (tsOf(a.createdAt) ?? tsOf(a.updatedAt) ?? 0)))
  }
  return sortRecent(docs)
}
export function listFolders(docs: VyroDoc[]): string[] { return Array.from(new Set(docs.filter(d=>!d.deletedAt).map(d=>d.folder).filter(Boolean))).sort() }

/** Validate + repair one stored entry; returns null for entries that cannot be used safely. */
export function sanitizeDoc(raw: any): VyroDoc | null {
  if (!raw || typeof raw !== 'object') return null
  if (typeof raw.id !== 'string' || !raw.id) return null
  if (!raw.content || typeof raw.content !== 'object') return null
  const now = new Date().toISOString()
  return {
    id: raw.id,
    title: typeof raw.title === 'string' && raw.title ? raw.title : 'Untitled',
    content: raw.content,
    html: typeof raw.html === 'string' ? raw.html : undefined,
    folder: typeof raw.folder === 'string' ? raw.folder : '',
    favorite: !!raw.favorite,
    dir: raw.dir === 'rtl' ? 'rtl' : 'ltr',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
    templateId: typeof raw.templateId === 'string' ? raw.templateId : undefined,
    margins: ['narrow','normal','moderate','wide','custom'].includes(raw.margins) ? raw.margins : 'normal',
    orientation: raw.orientation === 'landscape' ? 'landscape' : 'portrait',
    // Pagination mission fields — MUST be carried here or every reload
    // silently drops the document's paper size and custom geometry
    // (found by interactive test, 2026-10-31).
    pageSize: typeof raw.pageSize === 'string' && raw.pageSize ? raw.pageSize : undefined,
    pageW: typeof raw.pageW === 'number' && Number.isFinite(raw.pageW) ? raw.pageW : undefined,
    pageH: typeof raw.pageH === 'number' && Number.isFinite(raw.pageH) ? raw.pageH : undefined,
    customMargins: isMarginsShape(raw.customMargins) ? raw.customMargins : undefined,
    // Release mission: header/footer text — same drop-on-reload hazard as
    // the pagination fields above; carry them explicitly.
    headerText: typeof raw.headerText === 'string' && raw.headerText.trim() ? raw.headerText.trim().slice(0, 200) : undefined,
    footerText: typeof raw.footerText === 'string' && raw.footerText.trim() ? raw.footerText.trim().slice(0, 200) : undefined,
    deletedAt: typeof raw.deletedAt === 'string' && raw.deletedAt ? raw.deletedAt : undefined,
  }
}

/** Structural check for a stored custom-margins object (range validation
 * lives in lib/pageSetup; here we only keep well-formed data). */
function isMarginsShape(m: any): m is { top: number; right: number; bottom: number; left: number } {
  return !!m && typeof m === 'object'
    && ['top', 'right', 'bottom', 'left'].every(k => typeof m[k] === 'number' && Number.isFinite(m[k]))
}

type StorageLike = Pick<Storage,'getItem'> & Partial<Pick<Storage,'setItem'>>
export function loadDocs(storage: StorageLike): VyroDoc[] {
  let raw: string | null = null
  try { raw = storage.getItem(STORAGE_KEY) } catch { return [] }
  if (!raw) return []
  try {
    const p = JSON.parse(raw)
    if (!Array.isArray(p)) throw new Error('stored docs are not an array')
    // Drop/repair malformed entries instead of letting one bad record crash the whole library.
    return p.map(sanitizeDoc).filter((d): d is VyroDoc => d !== null)
  } catch {
    // Preserve the corrupt payload under a backup key instead of silently overwriting it on the next save.
    try { storage.setItem?.(CORRUPT_BACKUP_KEY, raw) } catch { /* backup is best-effort */ }
    return []
  }
}
/** Returns true on success, false when storage rejects the write (e.g. QuotaExceededError). Never throws. */
export function saveDocs(storage: Pick<Storage,'setItem'>, docs: VyroDoc[]): boolean {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(docs)); return true } catch { return false }
}
