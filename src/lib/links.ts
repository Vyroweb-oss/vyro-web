// Link Manager helpers (Mission 2, M2-07 = owner spec §14).
//
// Pure and local: no network, no storage-format change. collectLinks walks
// a TipTap doc JSON in document order and reports every link mark it finds.
// Validity reuses the editor's single rule (docText.ts isSafeLinkUrl): only
// http/https/mailto are safe; anything else (javascript:, data:, …) is
// flagged invalid so the panel can show it instead of silently dropping it.
//
// NOTE (pre-existing limitation, not rewritten here): the DOCX export path
// (docx.ts walk/runs) builds TextRuns from text nodes and ignores marks, so
// link marks do not survive a DOCX export today. Paste keeps safe links
// (paste.ts sanitizer) and drops unsafe ones, keeping the visible text.
// The panel therefore reports what is actually in the document, including
// links an export would lose — it never claims otherwise.

import { isSafeLinkUrl } from './docText'

export interface DocLink {
  /** Visible text of the link (may be empty for an image-only link). */
  text: string
  href: string
  /** True only for http/https/mailto, per isSafeLinkUrl. */
  valid: boolean
}

/** Collect every link in a TipTap doc JSON, in document order. */
export function collectLinks(docJson: any): DocLink[] {
  const out: DocLink[] = []
  const walk = (node: any): void => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'text') {
      const marks = Array.isArray(node.marks) ? node.marks : []
      for (const mark of marks) {
        if (mark?.type === 'link' && typeof mark.attrs?.href === 'string') {
          out.push({ text: node.text || '', href: mark.attrs.href, valid: isSafeLinkUrl(mark.attrs.href) })
        }
      }
    }
    if (Array.isArray(node.content)) node.content.forEach(walk)
  }
  walk(docJson)
  return out
}
