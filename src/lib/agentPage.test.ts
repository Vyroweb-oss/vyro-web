import { describe, it, expect } from 'vitest'
import { nodesForBuildAction, linesToNodes, nodesToText, tableNodes } from './agentPage'

describe('agentPage nodesForBuildAction', () => {
  it('builds a table with a header row and the requested size', () => {
    const nodes = nodesForBuildAction({ kind: 'insert-table', rows: 3, cols: 4 }, 'en')
    expect(nodes).not.toBeNull()
    const table = nodes![0] as { type: string; content: { content: { type: string }[] }[] }
    expect(table.type).toBe('table')
    expect(table.content).toHaveLength(3)
    expect(table.content[0].content).toHaveLength(4)
    expect(table.content[0].content[0].type).toBe('tableHeader')
    expect(table.content[1].content[0].type).toBe('tableCell')
  })

  it('builds heading + trailing paragraph', () => {
    const nodes = nodesForBuildAction({ kind: 'insert-heading', level: 2, text: 'Chapter one' }, 'en')!
    expect(nodes[0].type).toBe('heading')
    expect(nodes[1].type).toBe('paragraph')
    expect(nodesToText(nodes)).toContain('Chapter one')
  })

  it('builds list items from the action items', () => {
    const nodes = nodesForBuildAction({ kind: 'insert-list', ordered: true, items: ['a', 'b'] }, 'en')!
    expect(nodes[0].type).toBe('orderedList')
    expect(nodesToText(nodes)).toContain('a')
    expect(nodesToText(nodes)).toContain('b')
  })

  it('builds multi-line literal text as paragraphs', () => {
    const nodes = nodesForBuildAction({ kind: 'insert-text', text: 'one\ntwo' }, 'fa')!
    expect(nodes).toHaveLength(2)
    expect(nodesToText(nodes)).toBe('one\ntwo')
  })

  it('builds templates through the assistant engine', () => {
    const nodes = nodesForBuildAction({ kind: 'insert-template', template: 'cover', topic: 'Math' }, 'en')!
    expect(nodes.length).toBeGreaterThan(1)
    expect(nodesToText(nodes)).toContain('Math')
  })

  it('builds a page break node', () => {
    const nodes = nodesForBuildAction({ kind: 'insert-page-break' }, 'en')!
    expect(nodes[0].type).toBe('pageBreak')
  })

  it('returns null for non-build actions', () => {
    expect(nodesForBuildAction({ kind: 'help' }, 'en')).toBeNull()
    expect(nodesForBuildAction({ kind: 'unknown', input: 'x' }, 'en')).toBeNull()
    expect(nodesForBuildAction({ kind: 'research', topic: 'x', paragraphs: 3, insert: true }, 'en')).toBeNull()
    expect(nodesForBuildAction({ kind: 'answer', question: 'x?' }, 'en')).toBeNull()
    expect(nodesForBuildAction({ kind: 'document-summarize' }, 'en')).toBeNull()
    expect(nodesForBuildAction({ kind: 'selection-bold' }, 'en')).toBeNull()
  })
})

describe('agentPage linesToNodes + nodesToText', () => {
  it('round-trips plain lines', () => {
    const nodes = linesToNodes(['first', 'second'])
    expect(nodesToText(nodes)).toBe('first\nsecond')
  })

  it('makes a bullet list when asked', () => {
    const nodes = linesToNodes(['a', 'b'], true)
    expect(nodes[0].type).toBe('bulletList')
    expect(nodesToText(nodes)).toContain('a')
  })

  it('A-07b: enumeration answer lines insert as paragraphs, credit never a bullet', () => {
    const nodes = linesToNodes(['انبه', 'موز', 'آناناس', 'منبع: ویکی‌پدیا — https://fa.wikipedia.org/wiki/X'])
    expect(nodes.every((n) => n.type === 'paragraph')).toBe(true)
    expect(nodesToText(nodes)).toBe('انبه\nموز\nآناناس\nمنبع: ویکی‌پدیا — https://fa.wikipedia.org/wiki/X')
  })

  it('flattens table nodes with cell separators', () => {
    const text = nodesToText(tableNodes(2, 2))
    expect(typeof text).toBe('string')
  })
})
