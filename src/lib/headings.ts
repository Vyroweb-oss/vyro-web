// Heading outline for the Navigation Pane (Mission 2, M2-02 = owner spec §3).
// Two views of the same idea: extractHeadings works on stored TipTap JSON
// (pure, unit-tested), extractLiveHeadings works on the live ProseMirror doc
// and additionally carries the positions the pane needs for click-to-jump.

export interface HeadingItem {
  level: number
  text: string
  /** True when the heading has no text at all — the pane flags it. */
  empty: boolean
}

export interface LiveHeading extends HeadingItem {
  /** Doc position of the heading node itself. */
  from: number
  /** Doc position just past the heading node. */
  to: number
  /** Doc position of the heading's first content character (jump target). */
  contentPos: number
}

function nodeText(node: any): string {
  if (!node) return ''
  if (node.type === 'text') return node.text || ''
  if (Array.isArray(node.content)) return node.content.map(nodeText).join('')
  return ''
}

/** Headings from a stored TipTap JSON doc, in document order, nesting kept
 *  as level order (the pane renders indent from `level`). */
export function extractHeadings(docJson: any): HeadingItem[] {
  const out: HeadingItem[] = []
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'heading') {
      const text = nodeText(node)
      out.push({ level: node.attrs?.level || 1, text, empty: text.trim() === '' })
    }
    if (Array.isArray(node.content)) node.content.forEach(walk)
  }
  walk(docJson)
  return out
}

/** Headings from the live editor doc, with jump positions. */
export function extractLiveHeadings(doc: any): LiveHeading[] {
  const out: LiveHeading[] = []
  doc.descendants((node: any, pos: number) => {
    if (node.type.name === 'heading') {
      const text = node.textContent || ''
      out.push({
        level: node.attrs.level,
        text,
        empty: text.trim() === '',
        from: pos,
        to: pos + node.nodeSize,
        contentPos: pos + 1,
      })
      return false
    }
    return true
  })
  return out
}

/**
 * Index of the heading containing the cursor, or the nearest heading above
 * it when the cursor sits in body text. -1 when the cursor is before the
 * first heading. Headings never nest, so the last heading starting at or
 * before the cursor is exactly the containing / nearest-above one.
 */
export function activeHeadingIndex(headings: LiveHeading[], cursorPos: number): number {
  let active = -1
  for (let i = 0; i < headings.length; i++) {
    if (headings[i].from <= cursorPos) active = i
    else break
  }
  return active
}
