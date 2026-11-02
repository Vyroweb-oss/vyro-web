// Local Accessibility Checker (Mission 2, P2-5 — a Word-gap feature;
// extended in Phase 2, P2-16, with two further JSON-derivable rules, and
// in Phase 2, P2-18, with two more, and in Phase 2, P2-21, with two more,
// and in Phase 2, P2-22, with two more, and in Phase 2, P2-23, with two
// more, and in Phase 2, P2-24, with two more, and in Phase 2, P2-25,
// with two more, and in Phase 2, P2-26, with two more).
//
// Pure, READ-ONLY analysis over stored TipTap JSON: it never mutates the
// document, never touches storage, network, or the editor. Exactly twenty
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
//       legitimately fires both imageAltTooLong and imageAltDuplicate),
//   (11) images whose alt text is a single-token filename ending in a
//       known image extension (imageAltIsFilename — regex
//       /^[^\s]+\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i on the trimmed
//       alt; missing/empty alt is NOT flagged here, it is
//       imageAltMissing; a filename alt may legitimately also fire
//       imageAltTooLong / imageAltDuplicate, neither branch suppresses
//       the other),
//   (12) links whose visible text is the link's own URL (linkTextIsUrl
//       — the run's trimmed text compared case-insensitively with the
//       href after stripping a leading http:// or https://, a leading
//       www., and one trailing '/' from BOTH sides; empty runs are NOT
//       flagged here, they are already linkEmptyText; vague phrases are
//       unaffected),
//   (13) images whose alt text is exactly a generic word (imageAltVague
//       — exact match only, never substring, after the same duplicate
//       normalisation as (9)/(10); missing/empty alt is NOT flagged
//       here, it is imageAltMissing; this branch does not suppress the
//       long/duplicate/filename branches, and they do not suppress it),
//   (14) TOP-LEVEL headings whose section contains no readable content
//       (headingNoContent — hierarchical: for a top-level heading at
//       level L, a following heading with level <= L ends the section,
//       a following heading with level > L is a subsection and scanning
//       continues past it, a block counts as content when its recursive
//       trimmed text is non-empty or it is/contains an image node, and
//       empty paragraphs neither count nor stop the scan; reaching the
//       end of the document without content flags the heading).
//   (15) tables containing at least one merged cell (tableMergedCells —
//       a tableCell or tableHeader anywhere in its rows whose
//       attrs.colspan > 1 or attrs.rowspan > 1, numeric only; one issue
//       per table, never per cell; missing attrs, a span of 1, or a
//       non-numeric span value never flags; this branch does not
//       suppress tableNoHeader, and tableNoHeader does not suppress it,
//       so a merged-cell table with no header row fires both),
//   (16) links whose visible text repeats an earlier link's text but
//       points to a different destination (linkSameTextDifferentTarget
//       — per link RUN, as defined below; runs are grouped by the same
//       normalisation as (7), and a run is flagged only when its href
//       is new for that normalised text while an earlier run with the
//       same text already exists, so [A, A, B] flags only B and
//       [A, B, A] flags only B; empty runs are NOT flagged here, they
//       are already linkEmptyText; the vague/URL-text branches neither
//       suppress nor are suppressed by this rule).
//   (17) links with non-empty visible text but no destination
//       (linkMissingHref — per link RUN, as defined below; the run's
//       href is missing, non-string, empty, or whitespace-only; the
//       issue always carries href '' and the trimmed visible text;
//       empty runs are NOT flagged here, they are already
//       linkEmptyText; this branch neither suppresses nor is
//       suppressed by the vague/URL-text branches, so a vague-text
//       link with no href fires both; the URL-text branch already
//       cannot fire on an empty href).
//   (18) headings whose trimmed text is longer than 100 code points
//       (headingTooLong — counted in code points of the trimmed text,
//       so 100 passes and 101 flags; headingText carries the original,
//       unnormalised text; empty headings have length 0 and never
//       fire this, they are already headingEmpty; 100 is a
//       diagnostic threshold for screen-reader navigation, not a
//       hard WCAG limit).
//   (19) a document with more than one Heading 1 (headingMultipleH1 —
//       only the SECOND and later H1 headings are flagged, never the
//       first; empty H1 headings are excluded, they are already
//       headingEmpty; headingText carries the original, unnormalised
//       text; independent of headingDuplicateText / headingSkip /
//       firstHeadingNotH1, so a second H1 may legitimately fire
//       several rules).
//   (20) images whose alt text opens with a redundant word
//       (imageAltRedundantPrefix — the first whitespace-separated
//       token of the trimmed alt, lowercased, with trailing
//       punctuation (: , . ; - –) stripped, is one of image, photo,
//       picture, photograph, graphic, illustration, img, عکس, تصویر,
//       نگاره, AND there is more text after that first word, so an
//       exact vague alt such as 'photo' is NOT flagged here, it is
//       already imageAltVague; missing/empty alt is NOT flagged here,
//       it is already imageAltMissing; independent of the
//       long/duplicate/filename/vague branches, so a redundant-prefix
//       alt may legitimately fire several of them too).
//       LIMITATION, documented deliberately: only top-level headings are
//       evaluated for rule (14) — a heading nested inside a blockquote
//       or list item is never flagged by this rule (it is still covered
//       by the other heading rules, e.g. headingEmpty / headingSkip /
//       headingDuplicateText, which use extractHeadings over the whole
//       document). headingIndex for rule (14) still matches
//       extractHeadings order: headings nested inside earlier top-level
//       blocks are counted when assigning the index.
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
  | 'imageAltIsFilename'
  | 'linkTextIsUrl'
  | 'imageAltVague'
  | 'headingNoContent'
  | 'tableMergedCells'
  | 'linkSameTextDifferentTarget'
  | 'linkMissingHref'
  | 'headingTooLong'
  | 'headingMultipleH1'
  | 'imageAltRedundantPrefix'

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
  /** Trimmed visible link text, for linkVagueText / linkTextIsUrl issues. */
  linkText?: string
  /** Trimmed alt text, for imageAltDuplicate / imageAltIsFilename / imageAltVague issues. */
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
  imageAltIsFilename: 0,
  linkTextIsUrl: 0,
  imageAltVague: 0,
  headingNoContent: 0,
  tableMergedCells: 0,
  linkSameTextDifferentTarget: 0,
  linkMissingHref: 0,
  headingTooLong: 0,
  headingMultipleH1: 0,
  imageAltRedundantPrefix: 0,
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

/** Recursive text of a node (same shape as headings.ts nodeText). */
function nodeTextRecursive(node: any): string {
  if (!node || typeof node !== 'object') return ''
  if (node.type === 'text') return typeof node.text === 'string' ? node.text : ''
  if (Array.isArray(node.content)) return node.content.map(nodeTextRecursive).join('')
  return ''
}

/** True when the node itself is, or recursively contains, an image node. */
function nodeHasImage(node: any): boolean {
  if (!node || typeof node !== 'object') return false
  if (node.type === 'image') return true
  return Array.isArray(node.content) && node.content.some(nodeHasImage)
}

/** Number of heading nodes in a subtree, in document order. */
function countHeadings(node: any): number {
  if (!node || typeof node !== 'object') return 0
  const self = node.type === 'heading' ? 1 : 0
  return self + (Array.isArray(node.content)
    ? node.content.reduce((n: number, c: any) => n + countHeadings(c), 0)
    : 0)
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
  // Headings that are too long (P2-25, rule 18): trimmed text over
  // 100 code points flags; 100 passes. Empty headings have length 0
  // and never fire this (already headingEmpty). Independent of the
  // other heading rules — a long heading may legitimately also fire
  // headingSkip / headingDuplicateText / headingNoContent.
  // headingText carries the original, unnormalised text.
  headings.forEach((h, i) => {
    if ([...h.text.trim()].length > 100) {
      push({ kind: 'headingTooLong', headingIndex: i + 1, headingText: h.text, level: h.level })
    }
  })
  // Multiple Heading 1 headings (P2-26, rule 19): only the SECOND and
  // later non-empty H1 headings are flagged, never the first; empty
  // H1 headings are excluded (already headingEmpty). headingText
  // carries the original, unnormalised text. Independent of the
  // duplicate / skip / first-heading rules — a second H1 may
  // legitimately fire several of them.
  let seenH1 = false
  headings.forEach((h, i) => {
    if (h.level !== 1 || h.empty) return
    if (seenH1) {
      push({ kind: 'headingMultipleH1', headingIndex: i + 1, headingText: h.text, level: 1 })
    } else {
      seenH1 = true
    }
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

  // Headings with no content (P2-23, rule 14): TOP-LEVEL headings only
  // (see the header comment for the limitation). A top-level heading's
  // index is assigned in extractHeadings order, counting headings
  // nested inside earlier top-level blocks before it.
  const topBlocks: any[] = Array.isArray((docJson as any)?.content) ? (docJson as any).content : []
  let headingsSeenBefore = 0
  const topInfos = topBlocks.map((block: any) => {
    const isHeading = !!block && typeof block === 'object' && block.type === 'heading'
    const info = {
      node: block,
      isHeading,
      level: isHeading ? (block.attrs?.level || 1) : 0,
      text: isHeading ? nodeTextRecursive(block) : '',
      headingIndex: isHeading ? headingsSeenBefore + 1 : 0,
    }
    headingsSeenBefore += countHeadings(block)
    return info
  })
  topInfos.forEach((info, i) => {
    if (!info.isHeading) return
    let hasContent = false
    for (let j = i + 1; j < topInfos.length && !hasContent; j += 1) {
      const next = topInfos[j]
      if (next.isHeading) {
        // A heading at or above this level ends the section; a deeper
        // heading is a subsection — keep scanning past it (its own text
        // is not content, and content under it still counts).
        if (next.level <= info.level) break
      } else if (nodeHasImage(next.node) || nodeTextRecursive(next.node).trim() !== '') {
        hasContent = true
      }
      // Empty paragraphs (and other text-free, image-free blocks)
      // neither count as content nor stop the scan.
    }
    if (!hasContent) {
      push({ kind: 'headingNoContent', headingIndex: info.headingIndex, headingText: info.text, level: info.level })
    }
  })

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
        // Filename alt text (P2-22): a single token (no whitespace)
        // ending in a known image extension. Missing/empty alt is
        // excluded above. Neither this branch nor the long/duplicate
        // branches suppress each other.
        if (/^[^\s]+\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(trimmedAlt)) {
          push({ kind: 'imageAltIsFilename', imageIndex, altText: trimmedAlt })
        }
        // Vague alt text (P2-23): the normalised alt EXACTLY matches a
        // generic word — never a substring, so 'a photo of a cat' is
        // not vague. Missing/empty alt is excluded above. Neither this
        // branch nor the long/duplicate/filename branches suppress
        // each other, so a vague duplicate fires both rules.
        const VAGUE_ALT_TEXT = new Set([
          'image', 'photo', 'picture', 'img', 'graphic', 'illustration', 'photograph',
          'تصویر', 'عکس', 'نگاره',
        ])
        if (VAGUE_ALT_TEXT.has(normalizedAlt)) {
          push({ kind: 'imageAltVague', imageIndex, altText: trimmedAlt })
        }
        // Redundant-prefix alt text (P2-26, rule 20): the FIRST word
        // of the trimmed alt is a word screen readers already announce
        // for an image, followed by more text. Only the first token
        // counts — 'A photo of a cat' is not flagged (first word 'a'),
        // and an exact vague alt ('photo') is not flagged here either
        // (it has no more text; it is already imageAltVague).
        // Missing/empty alt is excluded above. Neither this branch nor
        // the long/duplicate/filename/vague branches suppress each other.
        const REDUNDANT_ALT_OPENING_WORDS = new Set([
          'image', 'photo', 'picture', 'photograph', 'graphic', 'illustration', 'img',
          'عکس', 'تصویر', 'نگاره',
        ])
        const altTokens = trimmedAlt.split(/\s+/)
        if (altTokens.length > 1) {
          const firstWord = altTokens[0].toLowerCase().replace(/[:,\.;\-–]+$/, '')
          if (REDUNDANT_ALT_OPENING_WORDS.has(firstWord)) {
            push({ kind: 'imageAltRedundantPrefix', imageIndex, altText: trimmedAlt })
          }
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
      // Merged cells (P2-24, rule 15): one issue per table, never per
      // cell, independent of the header rule above — neither branch
      // suppresses the other. Only a numeric span > 1 counts; missing
      // attrs, a span of 1, or a non-numeric span value never flags.
      const isMergedCell = (cellNode: any): boolean => {
        if (!cellNode || typeof cellNode !== 'object') return false
        if (cellNode.type !== 'tableCell' && cellNode.type !== 'tableHeader') return false
        const attrs = cellNode.attrs
        if (!attrs || typeof attrs !== 'object') return false
        return (typeof attrs.colspan === 'number' && attrs.colspan > 1)
          || (typeof attrs.rowspan === 'number' && attrs.rowspan > 1)
      }
      const hasMergedCell = Array.isArray(node.content) && node.content.some((row: any) =>
        row && typeof row === 'object' && row.type === 'tableRow' && Array.isArray(row.content)
          && row.content.some(isMergedCell))
      if (hasMergedCell) {
        push({ kind: 'tableMergedCells', tableIndex })
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
  // are already linkEmptyText, and flush() evaluates all link rules per
  // run (empty, then vague, then URL-text, in that order).
  const VAGUE_LINK_TEXT = new Set([
    'click here', 'here', 'this', 'link', 'more', 'read more', 'click',
    'اینجا', 'اینجا کلیک کنید', 'کلیک کنید', 'لینک', 'بیشتر',
  ])
  const normalizeLinkText = (text: string): string =>
    text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/ي/g, 'ی').replace(/ك/g, 'ک')
  // URL comparison for linkTextIsUrl (P2-22): case-insensitive, after
  // stripping a leading http:// or https://, a leading www., and one
  // trailing '/' from both the visible text and the href.
  const normalizeUrlForComparison = (value: string): string => {
    let v = value.trim().toLowerCase()
    v = v.replace(/^https?:\/\//, '').replace(/^www\./, '')
    if (v.endsWith('/')) v = v.slice(0, -1)
    return v
  }
  let linkIndex = 0
  // Every flushed link run, in document order, for the P2-24 rule (16)
  // pass below. A run split across same-href text nodes is recorded
  // once, with its full trimmed visible text.
  const linkRuns: { linkIndex: number; href: string; linkText: string }[] = []
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
        linkRuns.push({ linkIndex, href: runHref, linkText: trimmed })
        if (trimmed === '') {
          push({ kind: 'linkEmptyText', linkIndex, href: runHref })
        } else {
          if (VAGUE_LINK_TEXT.has(normalizeLinkText(runText))) {
            push({ kind: 'linkVagueText', linkIndex, href: runHref, linkText: trimmed })
          } else if (normalizeUrlForComparison(trimmed) !== '' && normalizeUrlForComparison(trimmed) === normalizeUrlForComparison(runHref)) {
            push({ kind: 'linkTextIsUrl', linkIndex, href: runHref, linkText: trimmed })
          }
          // Links with no destination (P2-25, rule 17): independent of
          // the vague/URL-text branches above, so a vague-text link
          // with no href fires both. linkHrefOf already coerces a
          // missing or non-string href to '', so a whitespace-only
          // href is the only remaining missing case; the issue always
          // carries href ''. Empty runs are excluded by the branch
          // above (already linkEmptyText).
          if (runHref.trim() === '') {
            push({ kind: 'linkMissingHref', linkIndex, href: '', linkText: trimmed })
          }
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

  // Same link text, different destinations (P2-24, rule 16): a second,
  // independent pass over the runs collected above, so it neither
  // suppresses nor is suppressed by the empty/vague/URL-text branches
  // (a run may legitimately carry both a vague/URL issue and this one).
  // Empty runs are skipped entirely (already linkEmptyText). A run is
  // flagged only when its normalised text was already seen with a
  // DIFFERENT href — i.e. its href is new for that text: [A, A, B]
  // flags only B, and [A, B, A] flags only B (the third run's href A
  // was already seen for that text, so it is not a new destination).
  // A group with a single distinct href therefore never flags.
  const seenLinkHrefsByText = new Map<string, Set<string>>()
  for (const run of linkRuns) {
    if (run.linkText === '') continue
    const normalized = normalizeLinkText(run.linkText)
    let hrefs = seenLinkHrefsByText.get(normalized)
    if (!hrefs) {
      hrefs = new Set<string>()
      seenLinkHrefsByText.set(normalized, hrefs)
    } else if (!hrefs.has(run.href)) {
      push({ kind: 'linkSameTextDifferentTarget', linkIndex: run.linkIndex, href: run.href, linkText: run.linkText })
    }
    hrefs.add(run.href)
  }

  return { issues, total: issues.length, counts }
}
