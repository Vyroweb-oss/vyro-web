// Document Compare (Mission 2, M2-09 = owner spec §7).
//
// Compares REAL document content (TipTap JSON) only — never titles, names
// or dates. Pure functions: no storage, no DOM, no network, and nothing
// here ever throws (malformed input yields empty lines / an empty diff).
// The docs store is never touched; saving a chosen side goes through the
// existing versions lib (createSnapshot + addVersion) only.

import { createSnapshot, addVersion, type VersionSnapshot } from './versions'

export type CompareLineKind =
  | 'paragraph'
  | 'heading'
  | 'listItem'
  | 'tableCell'
  | 'image'
  | 'break'
  | 'other'

export interface CompareLine {
  text: string
  kind: CompareLineKind
  /** Heading level (1-3) for headings; undefined otherwise. A level change
   *  therefore counts as a changed line, not an unchanged one. */
  level?: number
}

export type DiffHunkType = 'added' | 'removed' | 'changed' | 'unchanged'

export interface DiffHunk {
  type: DiffHunkType
  /** Lines from side A (empty for 'added'). */
  aLines: CompareLine[]
  /** Lines from side B (empty for 'removed'). For 'changed' hunks the two
   *  arrays are paired by index (same length). */
  bLines: CompareLine[]
  /** 0-based index of the first A line this hunk covers. */
  aStart: number
  /** 0-based index of the first B line this hunk covers. */
  bStart: number
}

export interface DiffSummary {
  added: number
  removed: number
  changed: number
  /** Number of hunks that are not 'unchanged' — the navigation target count. */
  diffHunks: number
}

export interface DiffResult {
  hunks: DiffHunk[]
  summary: DiffSummary
  aLines: CompareLine[]
  bLines: CompareLine[]
}

function inlineText(node: any): string {
  try {
    if (!node || typeof node !== 'object') return ''
    if (node.type === 'text') return typeof node.text === 'string' ? node.text : ''
    if (node.type === 'hardBreak') return ' '
    if (Array.isArray(node.content)) return node.content.map(inlineText).join('')
    return ''
  } catch {
    return ''
  }
}

/** Flatten one TipTap document JSON into ordered block lines. Never throws;
 *  anything that is not a recognisable document yields []. Empty-text
 *  blocks produce no line, so a document of blank paragraphs flattens to
 *  the same [] as a document with no blocks at all. */
export function flattenDocToLines(content: unknown): CompareLine[] {
  try {
    if (!content || typeof content !== 'object' || Array.isArray(content)) return []
    const root = content as { type?: unknown; content?: unknown }
    if (root.type !== 'doc' || !Array.isArray(root.content)) return []
    const lines: CompareLine[] = []
    const push = (text: string, kind: CompareLineKind, level?: number) => {
      if (text.trim() !== '') lines.push({ text, kind, level })
    }
    const walkBlocks = (blocks: any[]): void => {
      for (const node of blocks) {
        if (!node || typeof node !== 'object') continue
        switch (node.type) {
          case 'paragraph':
            push(inlineText(node), 'paragraph')
            break
          case 'heading': {
            const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 1
            push(inlineText(node), 'heading', level)
            break
          }
          case 'bulletList':
          case 'orderedList':
            if (Array.isArray(node.content)) walkBlocks(node.content)
            break
          case 'listItem': {
            // One line per list item: its paragraphs joined with a space,
            // then any nested list items as their own following lines.
            const parts: string[] = []
            const nested: any[] = []
            if (Array.isArray(node.content)) {
              for (const child of node.content) {
                if (child?.type === 'paragraph') parts.push(inlineText(child))
                else if (child?.type === 'bulletList' || child?.type === 'orderedList') nested.push(child)
                else if (child?.type === 'text') parts.push(inlineText(child))
              }
            }
            push(parts.join(' ').trim(), 'listItem')
            if (nested.length) walkBlocks(nested)
            break
          }
          case 'table':
            if (Array.isArray(node.content)) {
              for (const row of node.content) {
                if (!row || !Array.isArray(row.content)) continue
                for (const cell of row.content) {
                  if (!cell || !Array.isArray(cell.content)) continue
                  const cellParts: string[] = []
                  for (const child of cell.content) {
                    if (child?.type === 'paragraph' || child?.type === 'heading') cellParts.push(inlineText(child))
                  }
                  push(cellParts.join(' ').trim(), 'tableCell')
                }
              }
            }
            break
          case 'image': {
            const alt = typeof node.attrs?.alt === 'string' && node.attrs.alt.trim() ? node.attrs.alt.trim() : ''
            push(alt ? `[image: ${alt}]` : '[image]', 'image')
            break
          }
          case 'horizontalRule':
            push('[horizontal rule]', 'break')
            break
          case 'pageBreak':
            push('[page break]', 'break')
            break
          case 'blockquote':
            if (Array.isArray(node.content)) walkBlocks(node.content)
            break
          default:
            // Unknown block: recurse into its children if any, so nested
            // text is still compared instead of silently dropped.
            if (Array.isArray(node.content)) walkBlocks(node.content)
            break
        }
      }
    }
    walkBlocks(root.content)
    return lines
  } catch {
    return []
  }
}

function linesEqual(a: CompareLine, b: CompareLine): boolean {
  return a.text === b.text && a.kind === b.kind && a.level === b.level
}

type Op = { op: 'equal' | 'added' | 'removed'; a?: CompareLine; b?: CompareLine }

/** Classic LCS backtrack. Docs are small (editor documents), so the O(n*m)
 *  table is fine; inputs are capped defensively to avoid pathological
 *  quadratic blow-ups on huge pasted documents. */
function lcsOps(a: CompareLine[], b: CompareLine[]): Op[] {
  const MAX = 4000
  const aa = a.slice(0, MAX)
  const bb = b.slice(0, MAX)
  const n = aa.length
  const m = bb.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = linesEqual(aa[i], bb[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (linesEqual(aa[i], bb[j])) { ops.push({ op: 'equal', a: aa[i], b: bb[j] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ op: 'removed', a: aa[i] }); i++ }
    else { ops.push({ op: 'added', b: bb[j] }); j++ }
  }
  while (i < n) { ops.push({ op: 'removed', a: aa[i] }); i++ }
  while (j < m) { ops.push({ op: 'added', b: bb[j] }); j++ }
  return ops
}

/** Line-based diff of two TipTap documents. Never throws. */
export function compareDocs(aContent: unknown, bContent: unknown): DiffResult {
  try {
    const aLines = flattenDocToLines(aContent)
    const bLines = flattenDocToLines(bContent)
    const ops = lcsOps(aLines, bLines)
    const hunks: DiffHunk[] = []
    let aIdx = 0
    let bIdx = 0
    let k = 0
    const flushRun = (run: Op[], runAStart: number, runBStart: number): void => {
      if (!run.length) return
      const removed = run.filter((o) => o.op === 'removed').map((o) => o.a as CompareLine)
      const added = run.filter((o) => o.op === 'added').map((o) => o.b as CompareLine)
      const pairs = Math.min(removed.length, added.length)
      let aOff = 0
      let bOff = 0
      if (pairs > 0) {
        hunks.push({ type: 'changed', aLines: removed.slice(0, pairs), bLines: added.slice(0, pairs), aStart: runAStart, bStart: runBStart })
        aOff = pairs
        bOff = pairs
      }
      if (removed.length > pairs) {
        hunks.push({ type: 'removed', aLines: removed.slice(pairs), bLines: [], aStart: runAStart + aOff, bStart: runBStart + bOff })
      }
      if (added.length > pairs) {
        hunks.push({ type: 'added', aLines: [], bLines: added.slice(pairs), aStart: runAStart + aOff, bStart: runBStart + bOff })
      }
    }
    while (k < ops.length) {
      const op = ops[k]
      if (op.op === 'equal') {
        const startA = aIdx
        const startB = bIdx
        const eq: CompareLine[] = []
        while (k < ops.length && ops[k].op === 'equal') { eq.push(ops[k].a as CompareLine); aIdx++; bIdx++; k++ }
        hunks.push({ type: 'unchanged', aLines: eq, bLines: eq, aStart: startA, bStart: startB })
      } else {
        const runAStart = aIdx
        const runBStart = bIdx
        const run: Op[] = []
        while (k < ops.length && ops[k].op !== 'equal') {
          if (ops[k].op === 'removed') aIdx++
          else bIdx++
          run.push(ops[k])
          k++
        }
        flushRun(run, runAStart, runBStart)
      }
    }
    const summary: DiffSummary = {
      added: hunks.filter((h) => h.type === 'added').reduce((n, h) => n + h.bLines.length, 0),
      removed: hunks.filter((h) => h.type === 'removed').reduce((n, h) => n + h.aLines.length, 0),
      changed: hunks.filter((h) => h.type === 'changed').reduce((n, h) => n + h.aLines.length, 0),
      diffHunks: hunks.filter((h) => h.type !== 'unchanged').length,
    }
    return { hunks, summary, aLines, bLines }
  } catch {
    return { hunks: [], summary: { added: 0, removed: 0, changed: 0, diffHunks: 0 }, aLines: [], bLines: [] }
  }
}

/** Plain-text comparison report for copying. Never throws. */
export function renderComparisonReport(aLabel: string, bLabel: string, result: DiffResult): string {
  try {
    const s = result.summary
    const out: string[] = [
      `Comparison: ${aLabel} vs ${bLabel}`,
      `Added: ${s.added} · Removed: ${s.removed} · Changed: ${s.changed} · Diff hunks: ${s.diffHunks}`,
      '',
    ]
    if (s.diffHunks === 0) {
      out.push('No differences.')
      return out.join('\n')
    }
    for (const hunk of result.hunks) {
      if (hunk.type === 'unchanged') {
        for (const line of hunk.aLines) out.push(`  ${line.text}`)
      } else if (hunk.type === 'changed') {
        for (let i = 0; i < hunk.aLines.length; i++) {
          out.push(`- ${hunk.aLines[i].text}`)
          out.push(`+ ${hunk.bLines[i].text}`)
        }
      } else if (hunk.type === 'removed') {
        for (const line of hunk.aLines) out.push(`- ${line.text}`)
      } else {
        for (const line of hunk.bLines) out.push(`+ ${line.text}`)
      }
    }
    return out.join('\n')
  } catch {
    return 'Comparison unavailable.'
  }
}

/**
 * Build a new VersionSnapshot from a chosen side's content, via the
 * existing versions lib only. Returns null when the content is not a valid
 * document; the returned store is the input store plus the new snapshot
 * (caps enforced by addVersion). Nothing here writes storage or the docs
 * store — the caller persists with saveVersions.
 */
export function saveChosenSideAsVersion(
  versions: VersionSnapshot[],
  doc: { id: string; title: string },
  chosenContent: unknown,
  label?: string,
): { snapshot: VersionSnapshot; versions: VersionSnapshot[] } | null {
  try {
    const snap = createSnapshot({ id: doc.id, title: doc.title, content: chosenContent }, 'manual', label)
    if (!snap) return null
    return { snapshot: snap, versions: addVersion(versions, snap) }
  } catch {
    return null
  }
}
