// Pagination engine (Pagination mission, owner 2026-10-31).
//
// Pure layout math over measured segment heights — no DOM in here, so the
// break rules are unit-testable. The Editor measures the rendered blocks,
// splits straddling text blocks into line-level segments beforehand, and
// feeds segments in document order. A segment is either a whole top-level
// block or the continuation of a split block.
//
// Rules (Word-like):
//  - A segment that does not fit the remaining space moves to the next
//    page (segments are pre-split so a single segment never exceeds one
//    usable page, except unsplittable oversize blocks, which overflow in
//    place rather than vanishing).
//  - A segment flagged breakBefore (it follows a manual Page Break node)
//    always starts a new page.
//  - A trailing manual break yields one final empty page, as in Word.

export interface PageSegment {
  height: number
  /** True when a manual page-break node precedes this segment. */
  breakBefore?: boolean
}

export interface PageStart {
  /** Index of the segment that starts a new page. */
  index: number
  /** 0-based page this segment starts. */
  page: number
  /** Space already used on the previous page when the break happened. */
  usedBefore: number
}

export interface PaginationResult {
  pageCount: number
  starts: PageStart[]
  /** 0-based page index for every segment. */
  pageOf: number[]
}

const EPS = 1 // px tolerance so an exactly-full page does not spill

export function computePagination(segments: PageSegment[], usableHeightPx: number): PaginationResult {
  const starts: PageStart[] = []
  const pageOf: number[] = []
  let page = 0
  let used = 0
  let pendingBreak = false

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const h = Math.max(0, seg.height)
    const manual = pendingBreak || !!seg.breakBefore
    if (i > 0 && (manual || (used > 0 && used + h > usableHeightPx + EPS))) {
      starts.push({ index: i, page: page + 1, usedBefore: used })
      page += 1
      used = 0
    }
    pageOf.push(page)
    used += h
    pendingBreak = false
    // A segment taller than a whole page (unsplittable oversize block)
    // occupies its page and the following content starts fresh — the
    // block itself overflows its sheet visually rather than being cut.
    if (h > usableHeightPx + EPS) {
      used = usableHeightPx
    }
  }

  // Trailing manual break: the last segment carries breakBefore semantics
  // for a page that has no content yet — Word shows a final empty page.
  // The Editor signals this by appending a zero-height segment with
  // breakBefore when the document ends with a page-break node; that case
  // is already handled above (the zero segment starts the empty page).

  return { pageCount: page + 1, starts, pageOf }
}
