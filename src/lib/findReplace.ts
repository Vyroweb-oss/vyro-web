// Advanced Find & Replace (Mission 2, M2-02 = owner spec §5) + the shared
// in-document search used by the Navigation Pane (§3).
//
// FA/Dari/EN correctness rules, all covered by tests:
// - NOTHING is normalised away: no ZWNJ stripping, no digit conversion, no
//   Arabic→Persian letter folding. The query matches the document text
//   exactly as stored. (Dashboard search folds Arabic variants; in-document
//   search deliberately does not, so "می‌خواهم" never matches "می خواهم".)
// - Case sensitivity only affects Latin letters: Persian/Arabic script has
//   no case, so the toggle is a no-op for FA/Dari text. Case-insensitive
//   matching uses an escaped RegExp with the 'i' flag so match indices
//   always refer to the ORIGINAL text (toLowerCase on both sides could
//   shift indices for exotic characters whose lowercase is longer).
// - Whole-word boundaries are Unicode-aware: a word character is a Unicode
//   letter, number, or combining mark, plus the joiners ZWNJ (U+200C) and
//   ZWJ (U+200D) — a ZWNJ-joined Persian word is ONE word, not two.
// - Matches never overlap: after a match the scan resumes at its end, so
//   searching "aa" in "aaa" finds exactly one match.
// - All positions are ProseMirror document positions (from the live doc),
//   never string offsets into HTML. Replacement preserves the marks of the
//   replaced text as far as the document model allows.

export interface FindOptions {
  caseSensitive?: boolean
  wholeWord?: boolean
}

export interface TextMatch {
  start: number
  end: number
}

export interface DocMatch {
  from: number
  to: number
}

export interface DocBlock {
  /** Absolute doc position of the first character of this block's text. */
  from: number
  text: string
  /** posMap[i] = absolute doc position of text[i]. Atoms (images) occupy a
   *  doc position but contribute no character, so positions after an atom
   *  would be off by one with a naive offset — the map keeps them exact. */
  posMap: number[]
}

const ZWNJ = '\u200C'
const ZWJ = '\u200D'

function isWordChar(ch: string | undefined): boolean {
  if (ch === undefined) return false
  if (ch === ZWNJ || ch === ZWJ) return true
  return /[\p{L}\p{N}\p{M}]/u.test(ch)
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Non-overlapping matches of `query` in `text`. Empty query => no matches. */
export function findMatches(text: string, query: string, opts: FindOptions = {}): TextMatch[] {
  if (!query) return []
  const out: TextMatch[] = []
  const isBoundary = (start: number, end: number): boolean =>
    !opts.wholeWord || (!isWordChar(text[start - 1]) && !isWordChar(text[end]))
  if (opts.caseSensitive) {
    let i = 0
    for (;;) {
      const idx = text.indexOf(query, i)
      if (idx === -1) break
      const end = idx + query.length
      if (isBoundary(idx, end)) out.push({ start: idx, end })
      i = end
    }
    return out
  }
  // Case-insensitive: escaped regex keeps indices in the original text.
  const re = new RegExp(escapeRegExp(query), 'giu')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length
    if (isBoundary(m.index, end)) out.push({ start: m.index, end })
    if (m[0].length === 0) re.lastIndex++
  }
  return out
}

/** Every textblock in the doc, with exact character→position maps. */
export function docBlocks(doc: any): DocBlock[] {
  const blocks: DocBlock[] = []
  doc.descendants((node: any, pos: number) => {
    if (!node.isTextblock) return true
    const chars: string[] = []
    const posMap: number[] = []
    node.content.forEach((child: any, offset: number) => {
      if (!child.isText) return // atoms: no chars, position handled by offsets
      for (let k = 0; k < child.text.length; k++) {
        chars.push(child.text[k])
        posMap.push(pos + 1 + offset + k)
      }
    })
    blocks.push({ from: pos + 1, text: chars.join(''), posMap })
    return false // children already handled; don't descend into inline nodes
  })
  return blocks
}

/** All matches in the whole document (headings AND body text). */
export function findDocMatches(doc: any, query: string, opts: FindOptions = {}): DocMatch[] {
  if (!query) return []
  const out: DocMatch[] = []
  for (const block of docBlocks(doc)) {
    // A match ending at the block's last character has no posMap entry for
    // its end index — its end position is one past the last character.
    const blockEnd = block.posMap.length ? block.posMap[block.posMap.length - 1] + 1 : block.from
    for (const m of findMatches(block.text, query, opts)) {
      out.push({
        from: block.posMap[m.start],
        to: m.end < block.posMap.length ? block.posMap[m.end] : blockEnd,
      })
    }
  }
  return out
}

/** Short context snippet of a match with the replacement applied, for the
 *  preview shown BEFORE the user confirms Replace-one / Replace-all.
 *  `matchInBlock` is the match's offset inside `blockText`. */
export function previewSnippet(
  blockText: string,
  matchInBlock: TextMatch,
  replacement: string,
  context = 32,
): string {
  const start = Math.max(0, matchInBlock.start - context)
  const end = Math.min(blockText.length, matchInBlock.end + context)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < blockText.length ? '…' : ''
  return (
    prefix +
    blockText.slice(start, matchInBlock.start) +
    replacement +
    blockText.slice(matchInBlock.end, end) +
    suffix
  )
}

/** Block text + in-block match offset for a doc match (for previews). */
export function blockOfMatch(
  doc: any,
  match: DocMatch,
): { blockText: string; inBlock: TextMatch } | null {
  for (const block of docBlocks(doc)) {
    const blockEnd = block.posMap.length ? block.posMap[block.posMap.length - 1] + 1 : block.from
    if (match.from >= block.from && match.to <= blockEnd && block.posMap.length) {
      const start = block.posMap.indexOf(match.from)
      const end = block.posMap.indexOf(match.to - 1) + 1
      if (start !== -1 && end > start) return { blockText: block.text, inBlock: { start, end } }
    }
  }
  return null
}

// ---- Live-editor operations (duck-typed editor: the real TipTap editor) ----

/** Move the cursor to `pos` and scroll it into view. */
export function jumpToPosition(editor: any, pos: number): void {
  editor.chain().focus().setTextSelection(pos).scrollIntoView().run()
}

/** Select a match range and scroll it into view (active-match highlight). */
export function selectMatch(editor: any, match: DocMatch): void {
  editor.chain().focus().setTextSelection({ from: match.from, to: match.to }).scrollIntoView().run()
}

function marksAt(doc: any, from: number, to: number): any[] {
  let found: any[] = []
  doc.descendants((node: any, pos: number) => {
    if (node.isText && pos < to && pos + node.nodeSize > from && !found.length) found = node.marks
    return true
  })
  return found
}

/**
 * Replace ONE match. A single transaction, so it is a single undo step, and
 * the replacement text inherits the replaced text's marks (e.g. bold).
 * An empty replacement deletes the match.
 */
export function replaceMatch(editor: any, match: DocMatch, replacement: string): void {
  const tr = editor.state.tr
  if (replacement === '') tr.delete(match.from, match.to)
  else {
    const marks = marksAt(editor.state.doc, match.from, match.to)
    tr.replaceWith(match.from, match.to, editor.schema.text(replacement, marks))
  }
  editor.view.dispatch(tr)
}

/**
 * Replace ALL given matches in ONE transaction (descending order, so
 * earlier positions stay valid) — therefore ONE history entry: a single
 * Undo restores the pre-replace document. Callers pass the matches to
 * replace; scope filtering (selection vs whole document) is the caller's
 * job and is stated in the UI.
 */
export function replaceAllMatches(editor: any, matches: DocMatch[], replacement: string): void {
  const doc = editor.state.doc
  const ordered = [...matches].sort((a, b) => b.from - a.from)
  const tr = editor.state.tr
  for (const m of ordered) {
    if (replacement === '') tr.delete(m.from, m.to)
    else {
      const marks = marksAt(doc, m.from, m.to)
      tr.replaceWith(m.from, m.to, editor.schema.text(replacement, marks))
    }
  }
  editor.view.dispatch(tr)
}
