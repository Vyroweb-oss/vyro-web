// Small pure document-text helpers (P2-4 code-splitting, 2026-10-31).
//
// These used to live in docx.ts, which also imports the heavy `docx` and
// `file-saver` packages — so every hot-path caller (plain-text export,
// HTML export, link validation, paste) dragged the whole DOCX export
// engine into the initial bundle. The helpers have no heavy dependency,
// so they live here now and stay in the main chunk; docx.ts keeps only
// the DOCX export path and is loaded with dynamic import() from the
// editor's export handler. docx.ts re-exports these three names so
// existing imports (incl. tests) keep working unchanged.
/** Escape text for safe interpolation into generated HTML (titles, imported plain text). */
export function escapeHtml(s: string): string { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }
/** Validate a user-supplied link URL — only web/mail protocols may be stored or exported. */
export function isSafeLinkUrl(url: string): boolean { const u=(url||'').trim(); if(!u) return false; try{ const p=new URL(u, 'https://example.invalid'); return p.protocol==='http:'||p.protocol==='https:'||p.protocol==='mailto:' }catch{ return false } }
export function jsonToPlainText(node:any): string { let out=''; const rec=(n:any)=>{ if(!n) return; if(n.type==='text') out+=n.text||''; if(n.content) n.content.forEach(rec); if(['paragraph','heading','listItem'].includes(n.type)) out+='\n' }; rec(node); return out.replace(/\n{3,}/g,'\n\n').trim() }
