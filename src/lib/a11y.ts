// Local Accessibility Checker (Mission 2, P2-5 — a Word-gap feature).
//
// Pure, READ-ONLY analysis over stored TipTap JSON: it never mutates the
// document, never touches storage, network, or the editor. Exactly four
// local, JSON-derivable rules — nothing is faked:
//   (1) images missing alt text (attrs.alt missing, empty, or whitespace),
//   (2) heading level skips (e.g. H1 followed by H3),
//   (3) empty headings,
//   (4) tables whose first row has no header cell.
// Deliberately NOT covered: colour contrast — that needs rendered styles,
// which JSON alone cannot establish, so it is omitted rather than guessed.
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

  return { issues, total: issues.length, counts }
}
