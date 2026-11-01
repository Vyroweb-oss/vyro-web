// Local Accessibility Checker (Mission 2, P2-5 — a Word-gap feature;
// extended in Phase 2, P2-16, with two further JSON-derivable rules).
//
// Pure, READ-ONLY analysis over stored TipTap JSON: it never mutates the
// document, never touches storage, network, or the editor. Exactly six
// local, JSON-derivable rules — nothing is faked:
//   (1) images missing alt text (attrs.alt missing, empty, or whitespace),
//   (2) heading level skips (e.g. H1 followed by H3),
//   (3) empty headings,
//   (4) tables whose first row has no header cell,
//   (5) links with empty visible text (linkEmptyText),
//   (6) the document's first heading not being Heading 1
//       (firstHeadingNotH1, at most one per document).
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
}

function isHeaderCell(cell: any): boolean {
  return !!cell && typeof cell === 'object' && cell.type === 'tableHeader'
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
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'image') {
      imageIndex += 1
      const alt = node.attrs?.alt
      if (typeof alt !== 'string' || alt.trim() === '') {
        push({ kind: 'imageAltMissing', imageIndex })
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

  // Links with empty visible text, counted per link RUN (see the header
  // comment). Runs are scoped to one parent's content array: entering a
  // nested node flushes any open run and starts fresh inside it, so runs
  // never span paragraphs, list items, or table cells. A link mark with
  // no href counts as href ''.
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
        if (runText.trim() === '') push({ kind: 'linkEmptyText', linkIndex, href: runHref })
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
