// Local Accessibility Checker (Mission 2, P2-5 — a Word-gap feature;
// extended in Phase 2, P2-16, with two further JSON-derivable rules, and
// in Phase 2, P2-18, with two more, and in Phase 2, P2-21, with two more).
//
// Pure, READ-ONLY analysis over stored TipTap JSON: it never mutates the
// document, never touches storage, network, or the editor. Exactly ten
// local, JSON-derivable rules — nothing is faked:
//   (1) images missing alt text (attrs.alt missing, empty, or whitespace),
//   (2) heading level skips (e.g. H1 followed by H3),
//   (3) empty headings,
//   (4) tables whose first row has no header cell,
//   (5) links with empty visible text (linkEmptyText),
//   (6) the document's first heading not being Heading 1
//       (firstHeadingNotH1, at most one per document),
//   (7) links whose visible text is exactly a vague phrase
//       (linkVagueText — exact match only, never substring, after trim,
//       lowercasing, whitespace collapsing, and mapping Arabic Yeh/Kaf to
//       Persian Yeh/Kaf, so "click here for details" is NOT vague),
//   (8) images whose alt text is longer than 125 characters
//       (imageAltTooLong — counted in code points of the trimmed alt;
//       missing/empty alt is NOT flagged here, it is imageAltMissing),
//   (9) headings whose text duplicates an earlier heading's text
//       (headingDuplicateText — the first occurrence is never flagged,
//       only each later one; normalisation is trim + lowercasing +
//       collapsing internal whitespace + mapping Arabic Yeh/Kaf to
//       Persian Yeh/Kaf, with ZWNJ preserved; empty headings are NOT
//       flagged here, they are already headingEmpty),
//   (10) images whose alt text duplicates an earlier image's alt text
//       (imageAltDuplicate — same normalisation as (9), first occurrence
//       never flagged, only each later one; missing/empty alt is NOT
//       flagged here, it is imageAltMissing; a duplicate long alt
//       legitimately fires both imageAltTooLong and imageAltDuplicate).
// Deliberately NOT covered: colour contrast — that needs rendered styles,
// which JSON alone cannot establish, so it is omitted rather than guessed.
//
// A link RUN is consecutive text nodes sharing the same href inside one
// parent's content array: a link split across text nodes counts once.
// Any non-link text node, or any non-text node, breaks a run, and runs
// never span across different parents (e.g. a paragraph boundary or a
// list item / table cell boundary starts a fresh run).
//
// Heading rules reuse the existing helpers instead of duplicating them:
// extractHeadings (headings.ts) for the heading list and levelSkipWarnings
// (sections.ts) for the skip rule. levelSkipWarnings only reads each
// heading's level, so the HeadingItem list is passed through with a cast;
// no positions are invented or used here.

import { extractHeadings, type LiveHeading } from './headings'
import { levelSkipWarnings } from './sections'

export type A11yIssueKind =
  | 'imageAltMissing'
  | 'headingSkip'
  | 'headingEmpty'
  | 'tableNoHeader'
  | 'linkEmptyText'
  | 'firstHeadingNotH1'
  | 'linkVagueText'
  | 'imageAltTooLong'
  | 'headingDuplicateText'
  | 'imageAltDuplicate'

export interface A11yIssue {
  kind: A11yIssueKind
  /** 1-based ordinal among headings, for heading issues. */
  headingIndex?: number
  /** Heading text ('' for an empty heading); never normalised. */
  headingText?: string
  /** Heading level, for heading issues. */
  level?: number
  /** Previous heading's level, for heading-skip issues. */
  prevLevel?: number
  /** 1-based ordinal among images, for image issues. */
  imageIndex?: number
  /** 1-based ordinal among tables, for table issues. */
  tableIndex?: number
  /** 1-based ordinal among link runs, for link issues. */
  linkIndex?: number
  /** Link target, for link issues ('' when the link mark has no href). */
  href?: string
  /** Trimmed visible link text, for linkVagueText issues. */
  linkText?: string
  /** Trimmed alt text, for imageAltDuplicate issues. */
  altText?: string
}

export interface A11yResult {
  issues: A11yIssue[]
  /** Total issue count (== issues.length). */
  total: number
  /** Per-kind counts, in a fixed order for stable panel grouping. */
  counts: Record<A11yIssueKind, number>
}

const EMPTY_COUNTS: Record<A11yIssueKind, number> = {
  imageAltMissing: 0,
  headingSkip: 0,
  headingEmpty: 0,
  tableNoHeader: 0,
  linkEmptyText: 0,
  firstHeadingNotH1: 0,
  linkVagueText: 0,
  imageAltTooLong: 0,
  headingDuplicateText: 0,
  imageAltDuplicate: 0,
}

function isHeaderCell(cell: any): boolean {
  return !!cell && typeof cell === 'object' && cell.type === 'tableHeader'
}

/**
 * Normalisation shared by the duplicate-text rules (P2-21): trim,
 * lowercase, collapse internal whitespace, map Arabic Yeh (ي) / Kaf (ك)
 * to Persian (ی/ک). ZWNJ is preserved — it is not whitespace and is
 * never normalised away.
 */
function normalizeDuplicateText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/ي/g, 'ی').replace(/ك/g, 'ک')
}

/** Analyse a stored TipTap JSON doc. Null / malformed input => no issues. */
export function analyzeDoc(docJson: any): A11yResult {
  const issues: A11yIssue[] = []
  const counts: Record<A11yIssueKind, number> = { ...EMPTY_COUNTS }
  const push = (issue: A11yIssue) => {
    issues.push(issue)
    counts[issue.kind] += 1
  }

  // Headings (reused helpers; see the header comment).
  const headings = extractHeadings(docJson)
  headings.forEach((h, i) => {
    if (h.empty) push({ kind: 'headingEmpty', headingIndex: i + 1, headingText: h.text, level: h.level })
  })
  // Duplicate heading text (P2-21): only later occurrences are flagged,
  // never the first; empty headings are excluded (already headingEmpty).
  // headingText carries the original, unnormalised text.
  const seenHeadingTexts = new Set<string>()
  headings.forEach((h, i) => {
    if (h.empty) return
    const normalized = normalizeDuplicateText(h.text)
    if (seenHeadingTexts.has(normalized)) {
      push({ kind: 'headingDuplicateText', headingIndex: i + 1, headingText: h.text, level: h.level })
    } else {
      seenHeadingTexts.add(normalized)
    }
  })
  // levelSkipWarnings reads only `level`; HeadingItem carries no positions.
  const skips = levelSkipWarnings(headings as unknown as LiveHeading[])
  for (const s of skips) {
    const h = headings[s.index]
    push({
      kind: 'headingSkip',
      headingIndex: s.index + 1,
      headingText: h?.text ?? '',
      level: s.level,
      prevLevel: s.prevLevel,
    })
  }

  // First heading not Heading 1 (at most one per document). The skip
  // rule above never fires on the first heading (it has no predecessor),
  // so this is independent of it, not a change to it.
  if (headings.length > 0 && headings[0].level > 1) {
    push({
      kind: 'firstHeadingNotH1',
      headingIndex: 1,
      headingText: headings[0].text,
      level: headings[0].level,
    })
  }

  // Images + tables, in document order, anywhere in the doc (including
  // inside list items / blockquotes / table cells). A table's own first
  // row is inspected directly — never via its nested content walk.
  let imageIndex = 0
  let tableIndex = 0
  const seenAltTexts = new Set<string>()
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'image') {
      imageIndex += 1
      const alt = node.attrs?.alt
      if (typeof alt !== 'string' || alt.trim() === '') {
        push({ kind: 'imageAltMissing', imageIndex })
      } else {
        const trimmedAlt = alt.trim()
        if ([...trimmedAlt].length > 125) {
          push({ kind: 'imageAltTooLong', imageIndex })
        }
        // Duplicate alt text (P2-21): only later occurrences are flagged,
        // never the first; missing/empty alt is excluded above. A
        // duplicate long alt legitimately fires both rules, so neither
        // branch suppresses the other.
        const normalizedAlt = normalizeDuplicateText(trimmedAlt)
        if (seenAltTexts.has(normalizedAlt)) {
          push({ kind: 'imageAltDuplicate', imageIndex, altText: trimmedAlt })
        } else {
          seenAltTexts.add(normalizedAlt)
        }
      }
    } else if (node.type === 'table') {
      tableIndex += 1
      const firstRow = Array.isArray(node.content) ? node.content[0] : undefined
      const firstCells = firstRow && firstRow.type === 'tableRow' && Array.isArray(firstRow.content)
        ? firstRow.content
        : []
      if (!firstCells.some(isHeaderCell)) {
        push({ kind: 'tableNoHeader', tableIndex })
      }
    }
    if (Array.isArray(node.content)) node.content.forEach(walk)
  }
  walk(docJson)

  // Links with empty or vague visible text, counted per link RUN (see
  // the header comment). Runs are scoped to one parent's content array:
  // entering a nested node flushes any open run and starts fresh inside
  // it, so runs never span paragraphs, list items, or table cells. A link
  // mark with no href counts as href ''.
  //
  // Vague phrases are matched EXACTLY (never substring) against the run's
  // visible text after trim + lowercasing + collapsing internal
  // whitespace + mapping Arabic Yeh (ي) / Kaf (ك) to Persian (ی/ک), so
  // "CLICK  HERE" and "کلیک کنید" with Arabic letters both match, while
  // "click here for details" does not. Empty runs are NOT vague — they
  // are already linkEmptyText, and flush() evaluates both rules per run.
  const VAGUE_LINK_TEXT = new Set([
    'click here', 'here', 'this', 'link', 'more', 'read more', 'click',
    'اینجا', 'اینجا کلیک کنید', 'کلیک کنید', 'لینک', 'بیشتر',
  ])
  const normalizeLinkText = (text: string): string =>
    text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/ي/g, 'ی').replace(/ك/g, 'ک')
  let linkIndex = 0
  const linkHrefOf = (node: any): string | null => {
    if (!node || typeof node !== 'object' || node.type !== 'text' || !Array.isArray(node.marks)) return null
    const mark = node.marks.find((m: any) => m && typeof m === 'object' && m.type === 'link')
    if (!mark) return null
    const href = mark.attrs?.href
    return typeof href === 'string' ? href : ''
  }
  const walkLinks = (node: any) => {
    if (!node || typeof node !== 'object' || !Array.isArray(node.content)) return
    let runHref: string | null = null
    let runText = ''
    const flush = () => {
      if (runHref !== null) {
        linkIndex += 1
        const trimmed = runText.trim()
        if (trimmed === '') {
          push({ kind: 'linkEmptyText', linkIndex, href: runHref })
        } else if (VAGUE_LINK_TEXT.has(normalizeLinkText(runText))) {
          push({ kind: 'linkVagueText', linkIndex, href: runHref, linkText: trimmed })
        }
        runHref = null
        runText = ''
      }
    }
    for (const child of node.content) {
      const href = linkHrefOf(child)
      if (href !== null) {
        if (runHref !== null && runHref === href) {
          runText += typeof child.text === 'string' ? child.text : ''
        } else {
          flush()
          runHref = href
          runText = typeof child.text === 'string' ? child.text : ''
        }
      } else {
        flush()
        // Recurse into nested containers (paragraphs, list items, table
        // cells, ...) with a fresh run state; non-text leaves have no
        // content array and are simply skipped.
        walkLinks(child)
      }
    }
    flush()
  }
  walkLinks(docJson)

  return { issues, total: issues.length, counts }
}
