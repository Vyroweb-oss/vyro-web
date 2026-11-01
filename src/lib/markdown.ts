// Markdown export (Mission 2, P2-17 = M2-14 extension). Pure function:
// no DOM, no I/O, no network. Converts a Tiptap document JSON into
// GitHub-flavoured Markdown. Lossy by design — the preset panel states
// honestly what it keeps and drops (see exportPresets.ts).
//
// Rules that matter for honesty:
// - Local images never embed their data URL: '![alt]' with no src.
// - TOC entries carry NO page numbers (the TOC model has none).
// - Underline has no Markdown equivalent and is dropped.
// - Links export only when isSafeLinkUrl passes; unsafe hrefs degrade
//   to plain text instead of being silently dropped or kept verbatim.
import { isSafeLinkUrl } from './docText'

/** Escape the Markdown-significant characters of a plain-text run. */
function escapeText(s: string): string {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\|/g, '\\|')
}

/** Escape only brackets (alt text sits inside ![...]). */
function escapeAlt(s: string): string {
  return String(s ?? '').replace(/\[/g, '\\[').replace(/\]/g, '\\]')
}

function clampLevel(raw: any): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 1
  return Math.min(6, Math.max(1, Math.trunc(n)))
}

function inlineChildren(node: any): string {
  if (!node || typeof node !== 'object') return ''
  if (node.type === 'text') return renderInlineText(node)
  if (node.type === 'hardBreak') return '  \n'
  if (Array.isArray(node.content)) return node.content.map(inlineChildren).join('')
  return ''
}

/** Render one inline node (a text node or anything nested inside a
 *  paragraph's content) with its marks applied. */
function renderInlineText(node: any): string {
  let text = escapeText(node.text ?? '')
  const marks: any[] = Array.isArray(node.marks) ? node.marks : []
  const has = (t: string) => marks.some((m) => m?.type === t)
  const link = marks.find((m) => m?.type === 'link')
  if (has('code')) text = `\`${text}\``
  if (has('strike')) text = `~~${text}~~`
  if (has('italic')) text = `*${text}*`
  if (has('bold')) text = `**${text}**`
  // Underline has no Markdown equivalent: dropped, never rendered.
  if (link) {
    const href = String(link.attrs?.href ?? '').trim()
    if (isSafeLinkUrl(href)) text = `[${text}](${href})`
  }
  return text
}

/** Inline text of a block node (paragraph, heading, list item line,
 *  table cell): its content rendered as one run of inline nodes. */
function inlineOf(node: any): string {
  if (!node || typeof node !== 'object') return ''
  if (Array.isArray(node.content)) return node.content.map(inlineChildren).join('')
  return ''
}

/** Render a list (bulletList/orderedList) at the given nesting depth.
 *  Nested lists indent 2 spaces per depth; ordered numbering restarts
 *  at 1 for every list. Returns one line per item (nested items
 *  included), each already indented. */
function renderListLines(node: any, depth: number): string[] {
  const ordered = node.type === 'orderedList'
  const indent = '  '.repeat(depth)
  const lines: string[] = []
  let n = 1
  for (const item of Array.isArray(node.content) ? node.content : []) {
    if (!item || typeof item !== 'object') continue
    const marker = ordered ? `${n}. ` : '- '
    n++
    const itemLines: string[] = []
    for (const child of Array.isArray(item.content) ? item.content : []) {
      if (!child || typeof child !== 'object') continue
      if (child.type === 'paragraph' || child.type === 'heading') {
        itemLines.push(inlineOf(child))
      } else if (child.type === 'bulletList' || child.type === 'orderedList') {
        itemLines.push(...renderListLines(child, depth + 1))
      } else {
        // Any other block inside an item: render its lines as-is.
        const rendered = renderBlock(child)
        if (rendered) itemLines.push(...rendered.split('\n'))
      }
    }
    if (itemLines.length === 0) {
      lines.push(`${indent}${marker}`.trimEnd())
    } else {
      itemLines.forEach((line, i) => {
        lines.push(i === 0 ? `${indent}${marker}${line}` : line)
      })
    }
  }
  return lines
}

/** Render a table as GitHub-flavoured Markdown. The first row is always
 *  the header row (a tableHeader row when present, otherwise the first
 *  row); colspan/rowspan are NOT expanded — each cell renders once. */
function renderTable(node: any): string {
  const rows: any[] = (Array.isArray(node.content) ? node.content : [])
    .filter((r: any) => r && typeof r === 'object' && r.type === 'tableRow')
  if (rows.length === 0) return ''
  const cellText = (cell: any): string => {
    if (!cell || typeof cell !== 'object') return ''
    // A cell holds paragraphs; join them with a space (a Markdown table
    // cell is a single line). Pipe characters are escaped.
    const paras: string[] = []
    for (const child of Array.isArray(cell.content) ? cell.content : []) {
      if (child?.type === 'paragraph' || child?.type === 'heading') paras.push(inlineOf(child))
      else if (child) paras.push(inlineOf(child))
    }
    return escapeText(paras.join(' ').trim())
  }
  const rowCells = (row: any): string[] =>
    (Array.isArray(row.content) ? row.content : [])
      .filter((c: any) => c && typeof c === 'object' && (c.type === 'tableCell' || c.type === 'tableHeader'))
      .map(cellText)
  const header = rowCells(rows[0])
  if (header.length === 0) return ''
  const lines = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`]
  for (const row of rows.slice(1)) {
    const cells = rowCells(row)
    // Pad short body rows so every row has the header's column count.
    while (cells.length < header.length) cells.push('')
    lines.push(`| ${cells.join(' | ')} |`)
  }
  return lines.join('\n')
}

/** Render a TOC block: bold title, then one bullet per entry indented
 *  (level-1)*2 spaces, text only, NO page numbers. */
function renderToc(node: any): string {
  const titleRaw = node?.attrs?.title
  const title = typeof titleRaw === 'string' && titleRaw.trim() !== '' ? titleRaw : 'Contents'
  const lines = [`**${escapeText(title)}**`]
  const items: any[] = Array.isArray(node?.attrs?.items) ? node.attrs.items : []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const rawText = (item as any).text
    const text = typeof rawText === 'string' ? rawText : rawText != null ? String(rawText) : ''
    if (text.trim() === '') continue
    const level = clampLevel((item as any).level)
    lines.push(`${'  '.repeat(level - 1)}- ${escapeText(text)}`)
  }
  return lines.join('\n')
}

/** Render one block node as a single string (possibly multi-line).
 *  Unknown block nodes descend into their children so their text is
 *  never dropped. Returns '' for blocks that render nothing. */
function renderBlock(node: any): string {
  if (!node || typeof node !== 'object') return ''
  switch (node.type) {
    case 'heading': {
      const level = clampLevel(node.attrs?.level)
      return `${'#'.repeat(level)} ${inlineOf(node)}`
    }
    case 'paragraph':
      return inlineOf(node)
    case 'blockquote': {
      const inner = (Array.isArray(node.content) ? node.content : [])
        .map((c: any) => renderBlock(c))
        .filter((s: string) => s !== '')
        .join('\n\n')
      if (!inner) return ''
      return inner.split('\n').map((line: string) => (line ? `> ${line}` : '>')).join('\n')
    }
    case 'codeBlock': {
      const text = (Array.isArray(node.content) ? node.content : [])
        .map((c: any) => (c?.type === 'text' ? String(c.text ?? '') : c?.type === 'hardBreak' ? '\n' : inlineChildren(c)))
        .join('')
      return `\`\`\`\n${text}\n\`\`\``
    }
    case 'horizontalRule':
    case 'pageBreak':
      return '---'
    case 'bulletList':
    case 'orderedList':
      return renderListLines(node, 0).join('\n')
    case 'listItem':
      // A bare list item outside a list: render its blocks unmarked.
      return (Array.isArray(node.content) ? node.content : [])
        .map((c: any) => renderBlock(c))
        .filter((s: string) => s !== '')
        .join('\n')
    case 'table':
      return renderTable(node)
    case 'image': {
      const alt = escapeAlt(node.attrs?.alt ?? '')
      const src = String(node.attrs?.src ?? '').trim()
      if (/^https?:\/\//i.test(src)) return `![${alt}](${src})`
      // Data URLs and local paths are never embedded.
      return `![${alt}]`
    }
    case 'tocBlock':
      return renderToc(node)
    default:
      // Unknown block: descend into children, never drop their text.
      return (Array.isArray(node.content) ? node.content : [])
        .map((c: any) => renderBlock(c))
        .filter((s: string) => s !== '')
        .join('\n\n')
  }
}

/** Convert a Tiptap document JSON to Markdown. Empty/null input → ''. */
export function jsonToMarkdown(docJson: any): string {
  if (!docJson || typeof docJson !== 'object') return ''
  const blocks: any[] = docJson.type === 'doc'
    ? (Array.isArray(docJson.content) ? docJson.content : [])
    : [docJson]
  const parts = blocks.map((b: any) => renderBlock(b)).filter((s: string) => s !== '')
  return parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
}
