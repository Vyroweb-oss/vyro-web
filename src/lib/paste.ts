// Paste sanitizer + contextual-menu logic (Mission 2, item M2-06).
//
// Everything here is pure and local: no network, no upload, no storage
// format change. The editor only ever inserts what this module returns,
// and malformed input falls back to plain text (never a broken document).

/** Tags whose whole subtree is dropped (content included). */
const DROP_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button',
  'select', 'textarea', 'video', 'audio', 'source', 'track', 'canvas',
  'svg', 'math', 'noscript', 'template', 'link', 'meta', 'title', 'head',
])
/** Tags kept as-is (attributes filtered below). */
const KEEP_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'strong', 'b',
  'em', 'i', 'u', 's', 'strike', 'a', 'br', 'table', 'thead', 'tbody',
  'tfoot', 'tr', 'th', 'td', 'img', 'hr',
])
/** Tags unwrapped: the tag goes away, its children stay. */
const UNWRAP_TAGS = new Set([
  'div', 'section', 'article', 'span', 'font', 'small', 'sub', 'sup',
  'code', 'pre', 'mark', 'abbr', 'cite', 'q', 'address', 'main', 'figure',
  'figcaption', 'caption', 'colgroup', 'col',
])

/** Safe link/image protocols. Mirrors the editor's link rule (docx.ts). */
export function isSafePasteUrl(url: string): boolean {
  const u = (url || '').trim()
  if (!u) return false
  try {
    const p = new URL(u, 'https://example.invalid')
    if (p.protocol === 'http:' || p.protocol === 'https:' || p.protocol === 'mailto:') return true
    // Local image data URLs are how Vyro stores inserted images already;
    // allow them only for images (checked by the caller via the tag).
    if (p.protocol === 'data:') return /^data:image\/(png|jpeg|gif|webp|svg\+xml);/i.test(u)
    return false
  } catch {
    return false
  }
}

const DANGEROUS_STYLE = /javascript\s*:|vbscript\s*:|expression\s*\(|url\s*\(\s*['"]?\s*javascript|behaviour\s*:|behavior\s*:|-moz-binding|data\s*:\s*text\/html/i

/** Strip dangerous declarations from a style attribute; '' when nothing safe remains. */
export function sanitizeStyle(style: string): string {
  return (style || '')
    .split(';')
    .map((d) => d.trim())
    .filter((d) => {
      if (!d) return false
      const [prop] = d.split(':')
      const p = (prop || '').trim().toLowerCase()
      // Layout escapes the page and is never a document style.
      if (p === 'position' || p === 'z-index' || p === 'top' || p === 'left' || p === 'right' || p === 'bottom') return false
      if (DANGEROUS_STYLE.test(d)) return false
      return true
    })
    .join('; ')
}

function cleanNode(node: Node): void {
  const children = Array.from(node.childNodes)
  for (const child of children) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as HTMLElement
      const tag = el.tagName.toLowerCase()
      if (DROP_TAGS.has(tag)) {
        el.remove()
        continue
      }
      if (KEEP_TAGS.has(tag)) {
        // Strip every attribute, then restore only the safe ones.
        const href = el.getAttribute('href')
        const src = el.getAttribute('src')
        const alt = el.getAttribute('alt')
        const dir = el.getAttribute('dir')
        const style = sanitizeStyle(el.getAttribute('style') || '')
        const colspan = el.getAttribute('colspan')
        const rowspan = el.getAttribute('rowspan')
        for (const attr of Array.from(el.attributes)) el.removeAttribute(attr.name)
        if (tag === 'a') {
          if (href && isSafePasteUrl(href)) el.setAttribute('href', href.trim())
          else {
            // Unsafe link: unwrap, keeping the visible text.
            const parent = el.parentNode
            if (parent) { while (el.firstChild) parent.insertBefore(el.firstChild, el); el.remove() }
            continue
          }
        }
        if (tag === 'img') {
          const safeSrc = src && (isSafePasteUrl(src) || /^data:image\//i.test(src.trim()))
          // Pasted data URLs bypass the 2 MB local-file cap, so enforce the
          // same bound here (base64 inflates ~4/3): oversized images are
          // dropped rather than bloating local storage.
          const oversized = !!src && src.startsWith('data:') && src.length > 2800000
          if (!safeSrc || oversized) { el.remove(); continue }
          el.setAttribute('src', src!.trim())
          if (alt) el.setAttribute('alt', alt)
        }
        if ((tag === 'td' || tag === 'th') && colspan && /^\d+$/.test(colspan)) el.setAttribute('colspan', colspan)
        if ((tag === 'td' || tag === 'th') && rowspan && /^\d+$/.test(rowspan)) el.setAttribute('rowspan', rowspan)
        if (dir && /^(rtl|ltr|auto)$/i.test(dir)) el.setAttribute('dir', dir.toLowerCase())
        if (style) el.setAttribute('style', style)
        cleanNode(el)
      } else if (UNWRAP_TAGS.has(tag)) {
        const parent = el.parentNode
        cleanNode(el)
        if (parent) { while (el.firstChild) parent.insertBefore(el.firstChild, el); el.remove() }
      } else {
        // Unknown tag: unwrap, keeping its text/structure.
        const parent = el.parentNode
        cleanNode(el)
        if (parent) { while (el.firstChild) parent.insertBefore(el.firstChild, el); el.remove() }
      }
    } else if (child.nodeType === Node.COMMENT_NODE) {
      child.remove()
    }
  }
}

/**
 * Sanitize pasted HTML. Returns '' when nothing survives (caller then
 * falls back to plain text) or when parsing fails. Never throws on
 * malformed input: a DOMParser that chokes still yields text nodes.
 */
export function sanitizePastedHtml(html: string): string {
  if (!html || !html.trim()) return ''
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const body = doc.body
    if (!body) return ''
    cleanNode(body)
    return body.innerHTML.trim()
  } catch {
    return ''
  }
}

/** Plain text extracted from HTML (the malformed-input fallback). */
export function htmlToPlainText(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    return (doc.body?.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
  } catch {
    return html.replace(/<[^>]*>/g, '').trim()
  }
}

/**
 * Decide what a paste carries: 'formatted' when the clipboard HTML has
 * surviving structure, 'plain' otherwise. Plain-text pastes (no HTML at
 * all) are always 'plain', so behaviour stays predictable.
 */
export function classifyPaste(html: string | null | undefined): 'plain' | 'formatted' {
  if (!html || !html.trim()) return 'plain'
  // No markup at all = plain text, even though the parser would echo it back.
  if (!/<[a-zA-Z][^>]*>/.test(html)) return 'plain'
  return sanitizePastedHtml(html) ? 'formatted' : 'plain'
}

// ---------------------------------------------------------------------------
// Contextual-menu applicability (pure, so it is unit-testable without an
// editor instance). Only applicable actions are returned, in display order.
// ---------------------------------------------------------------------------

export type MenuItemId =
  | 'cut' | 'copy' | 'pastePlain' | 'clearFormatting' | 'bold' | 'italic' | 'link'
  | 'addRow' | 'addColumn' | 'deleteRow' | 'deleteColumn' | 'mergeCells' | 'splitCell'
  | 'imageAlt' | 'alignLeft' | 'alignCenter' | 'alignRight' | 'deleteImage'
  | 'editLink' | 'removeLink' | 'openLink'

export interface MenuContext {
  /** Non-collapsed text selection exists. */
  hasSelection: boolean
  /** Caret/selection is inside a table cell. */
  inTable: boolean
  /** The selection is an image node. */
  inImage: boolean
  /** Caret/selection carries a link mark. */
  inLink: boolean
  /** Safe href of the link under the cursor, if any (open only when set). */
  linkHref?: string | null
  /** Tier-1 S6: merge/split availability for the current table selection,
   *  computed by tableMenuAvailability from the live selection state. */
  table?: { merge: boolean; split: boolean }
}

export function getContextMenuItems(ctx: MenuContext): MenuItemId[] {
  const items: MenuItemId[] = []
  if (ctx.hasSelection) items.push('cut', 'copy')
  // Paste-as-plain-text is always offered: it reads the clipboard on demand.
  items.push('pastePlain')
  if (ctx.hasSelection) items.push('clearFormatting', 'bold', 'italic', 'link')
  if (ctx.inTable) {
    items.push('addRow', 'addColumn', 'deleteRow', 'deleteColumn')
    if (ctx.table?.merge) items.push('mergeCells')
    if (ctx.table?.split) items.push('splitCell')
  }
  if (ctx.inImage) items.push('imageAlt', 'alignLeft', 'alignCenter', 'alignRight', 'deleteImage')
  if (ctx.inLink) {
    items.push('editLink', 'removeLink')
    if (ctx.linkHref && isSafePasteUrl(ctx.linkHref)) items.push('openLink')
  }
  return items
}

/** Clamp a menu's top-left corner so it never leaves the viewport. */
export function clampMenuPosition(
  x: number, y: number, menuWidth: number, menuHeight: number,
  viewportWidth: number, viewportHeight: number, margin = 8,
): { x: number; y: number } {
  const maxX = Math.max(margin, viewportWidth - menuWidth - margin)
  const maxY = Math.max(margin, viewportHeight - menuHeight - margin)
  return { x: Math.min(Math.max(margin, x), maxX), y: Math.min(Math.max(margin, y), maxY) }
}

// ---------------------------------------------------------------------------
// Tier-1 S6: table merge/split availability (pure mirrors of the
// prosemirror-tables engine rules, so the menu never offers an action the
// engine would reject — and never hides one it would accept).
// ---------------------------------------------------------------------------

export interface SpanRect { top: number; left: number; bottom: number; right: number }

/**
 * Mirror of prosemirror-tables' cellsOverlapRectangle, on plain data:
 * true when a cell from OUTSIDE the rect protrudes INTO it (the engine
 * refuses to merge such a selection). A span lying fully inside the rect
 * is fine and does not count as overlap.
 */
export function rectOverlapsSpans(map: number[], width: number, height: number, rect: SpanRect): boolean {
  let indexTop = rect.top * width + rect.left
  let indexLeft = indexTop
  let indexBottom = (rect.bottom - 1) * width + rect.left
  let indexRight = indexTop + (rect.right - rect.left - 1)
  for (let i = rect.top; i < rect.bottom; i++) {
    if ((rect.left > 0 && map[indexLeft] === map[indexLeft - 1]) ||
        (rect.right < width && map[indexRight] === map[indexRight + 1])) return true
    indexLeft += width
    indexRight += width
  }
  for (let i = rect.left; i < rect.right; i++) {
    if ((rect.top > 0 && map[indexTop] === map[indexTop - width]) ||
        (rect.bottom < height && map[indexBottom] === map[indexBottom + width])) return true
    indexTop++
    indexBottom++
  }
  return false
}

export type TableSelectionState =
  /** A cell selection spanning more than one cell; `overlaps` is the
   *  engine's protrusion check above. */
  | { kind: 'multi'; overlaps: boolean }
  /** One targeted cell (caret inside it, or a one-cell selection). */
  | { kind: 'single'; colspan: number; rowspan: number }

/**
 * The engine's own gates, restated:
 * - mergeCells needs a multi-cell selection whose rectangle is not
 *   overlapped by an outside span.
 * - splitCell needs ONE targeted cell with colspan or rowspan > 1 — it
 *   un-merges a spanned cell; it cannot split a plain 1x1 cell, and the
 *   menu must not pretend otherwise.
 */
export function tableMenuAvailability(state: TableSelectionState | null | undefined): { merge: boolean; split: boolean } {
  if (!state) return { merge: false, split: false }
  if (state.kind === 'multi') return { merge: !state.overlaps, split: false }
  return { merge: false, split: state.colspan > 1 || state.rowspan > 1 }
}
