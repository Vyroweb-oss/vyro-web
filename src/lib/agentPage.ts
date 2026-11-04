// Vyro Agent page helpers (owner order 2026-11-03 ~20:12: ONE dedicated
// section inside Vyro that is only for the agent, like other AI
// assistants — users write their request in that one place and the
// agent properly prepares it there). Pure node builders so the page can
// prepare document content WITHOUT an open editor: the result can then
// be inserted into the open document or turned into a brand-new one.
// Everything here is data only — no fetching, no storage, no editor.
import { buildTemplate, type AssistantAction } from './assistant'
import type { UiLang } from './i18n'

type JsonNode = { type: string; attrs?: Record<string, unknown>; content?: JsonNode[]; text?: string }

const para = (text = ''): JsonNode =>
  text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' }

const head = (level: number, text = ''): JsonNode => ({
  type: 'heading',
  attrs: { level },
  content: text ? [{ type: 'text', text }] : [],
})

/** Table node matching the editor's table schema (header row first). */
export function tableNodes(rows: number, cols: number): JsonNode[] {
  const body: JsonNode[] = []
  for (let r = 0; r < rows; r++) {
    const cells: JsonNode[] = []
    for (let c = 0; c < cols; c++) {
      cells.push({ type: r === 0 ? 'tableHeader' : 'tableCell', content: [para()] })
    }
    body.push({ type: 'tableRow', content: cells })
  }
  return [{ type: 'table', content: body }, para()]
}

/**
 * Document nodes for the assistant's build commands, or null when the
 * action is not a build-into-document action (research/answer/selection
 * and document commands are handled by the page itself).
 */
export function nodesForBuildAction(action: AssistantAction, lang: UiLang): JsonNode[] | null {
  switch (action.kind) {
    case 'insert-table':
      return tableNodes(action.rows, action.cols)
    case 'insert-heading':
      return [head(action.level, action.text), para()]
    case 'insert-list': {
      const items = action.items.length > 0 ? action.items : ['', '', '']
      return [{
        type: action.ordered ? 'orderedList' : 'bulletList',
        content: items.map((i) => ({ type: 'listItem', content: [para(i)] })),
      }, para()]
    }
    case 'insert-text':
      return action.text.split('\n').map((l) => para(l))
    case 'insert-template':
      return buildTemplate(action.template, lang, action.topic) as JsonNode[]
    case 'insert-page-break':
      return [{ type: 'pageBreak' }, para()]
    case 'insert-date': {
      const date = new Date().toLocaleDateString(lang === 'fa' ? 'fa-AF' : 'en-GB', { dateStyle: 'full' })
      return [para(date)]
    }
    default:
      return null
  }
}

/** Plain paragraph (or bullet list) nodes from result lines. */
export function linesToNodes(lines: string[], asList = false): JsonNode[] {
  if (asList) {
    return [{
      type: 'bulletList',
      content: lines.map((l) => ({ type: 'listItem', content: [para(l)] })),
    }]
  }
  return lines.map((l) => para(l))
}

/**
 * A-09: the exact text a result shows on screen, for the Copy
 * action — list results copy with their • bullets, plain results
 * line by line, so the clipboard always matches what the user saw.
 */
export function formatResultLines(lines: string[], asList = false): string {
  return asList ? lines.map((l) => `• ${l}`).join('\n') : lines.join('\n')
}

/** Flatten document nodes to plain text (for the Copy action). */
export function nodesToText(nodes: unknown[]): string {
  const out: string[] = []
  const walk = (n: unknown): string => {
    if (!n || typeof n !== 'object') return ''
    const node = n as JsonNode
    if (node.type === 'text') return node.text ?? ''
    const inner = (node.content ?? []).map(walk).join(node.type === 'tableRow' ? ' | ' : '')
    if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'listItem' || node.type === 'tableRow') {
      return inner + '\n'
    }
    return inner
  }
  for (const n of nodes) out.push(walk(n))
  return out.join('').replace(/\n{3,}/g, '\n\n').trim()
}
