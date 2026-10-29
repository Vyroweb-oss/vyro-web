import type { VyroDoc } from './types'
import { uid } from './types'
export const STORAGE_KEY = 'vyro-web-docs-v1'
export const CORRUPT_BACKUP_KEY = 'vyro-web-docs-v1.corrupt-backup'
// Pure logic separated from React / localStorage for testability

function deepCopy<T>(v: T): T { return v === undefined ? v : JSON.parse(JSON.stringify(v)) }

export function createDoc(docs: VyroDoc[], partial: Partial<VyroDoc> & { title: string }): { docs: VyroDoc[]; doc: VyroDoc } {
  const now = new Date().toISOString()
  const doc: VyroDoc = { id: uid(), content: deepCopy(partial.content) ?? { type:'doc', content:[{type:'paragraph'}] }, folder: partial.folder ?? '', favorite: !!partial.favorite, dir: partial.dir ?? 'ltr', createdAt: now, updatedAt: now, margins: partial.margins ?? 'normal', orientation: partial.orientation ?? 'portrait', templateId: partial.templateId, html: partial.html, title: partial.title }
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
  const copy: VyroDoc = { ...src, content: deepCopy(src.content), html: src.html, id: uid(), title: src.title+' (copy)', createdAt: now, updatedAt: now }
  return [copy, ...docs]
}
export function deleteDoc(docs: VyroDoc[], id: string): VyroDoc[] { return docs.filter(d=>d.id!==id) }
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
  let out=[...docs]; if(opts.query) out=searchDocs(out,opts.query); if(opts.favoritesOnly) out=out.filter(d=>d.favorite); if(opts.folder!==undefined && opts.folder!=='') out=out.filter(d=>d.folder===opts.folder); return sortRecent(out)
}
export function sortRecent(docs: VyroDoc[]): VyroDoc[] { return [...docs].sort((a,b)=> (new Date(b.updatedAt).getTime()||0)-(new Date(a.updatedAt).getTime()||0)) }
export function listFolders(docs: VyroDoc[]): string[] { return Array.from(new Set(docs.map(d=>d.folder).filter(Boolean))).sort() }

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
    margins: ['narrow','normal','wide'].includes(raw.margins) ? raw.margins : 'normal',
    orientation: raw.orientation === 'landscape' ? 'landscape' : 'portrait',
  }
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
