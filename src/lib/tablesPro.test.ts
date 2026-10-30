import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { TableKit } from '@tiptap/extension-table'

// Same extension stack as the app's editor for tables (TableKit resizable
// + TextAlign over paragraphs, which is how cell alignment is done: the
// paragraph inside the cell carries the alignment, not the cell itself).
const editors: Editor[] = []
function makeEditor(content: any, extra: any = {}) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const ed = new Editor({
    element,
    extensions: [StarterKit, TextAlign.configure({ types: ['heading', 'paragraph'] }), TableKit.configure({ table: { resizable: true } })],
    content,
    ...extra,
  })
  editors.push(ed)
  return ed
}
afterEach(() => { while (editors.length) editors.pop()!.destroy() })

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const cell = (text: string, extra: any = {}) => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null, ...extra }, content: [para(text)] })
const headerCell = (text: string) => ({ type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [para(text)] })
const row = (cells: any[]) => ({ type: 'tableRow', content: cells })
const tableDoc = (rows: any[]) => ({ type: 'doc', content: [{ type: 'table', content: rows }] })
const simpleDoc = () => tableDoc([row([headerCell('H1'), headerCell('H2')]), row([cell('a'), cell('b')])])

/** Put the text cursor inside the first table cell's paragraph. */
function cursorInFirstCell(ed: Editor) {
  let target = -1
  ed.state.doc.descendants((n: any, pos: number) => {
    if (target < 0 && n.type.name === 'tableCell') target = pos + 2
  })
  expect(target).toBeGreaterThanOrEqual(0)
  ed.commands.setTextSelection(target)
}

describe('tables Pro: before/after + delete row/column', () => {
  it('addRowBefore/addRowAfter and addColumnBefore/addColumnAfter grow the table', () => {
    const ed = makeEditor(simpleDoc())
    cursorInFirstCell(ed)
    expect(ed.commands.addRowBefore()).toBe(true)
    expect(ed.commands.addRowAfter()).toBe(true)
    expect(ed.commands.addColumnBefore()).toBe(true)
    expect(ed.commands.addColumnAfter()).toBe(true)
    const table = (ed.getJSON() as any).content[0]
    expect(table.content.length).toBe(4) // 2 rows + 2
    expect(table.content[0].content.length).toBe(4) // 2 cols + 2
  })
  it('deleteRow/deleteColumn shrink the table', () => {
    const ed = makeEditor(simpleDoc())
    cursorInFirstCell(ed)
    expect(ed.commands.deleteColumn()).toBe(true)
    expect(ed.commands.deleteRow()).toBe(true)
    const table = (ed.getJSON() as any).content[0]
    expect(table.content.length).toBe(1)
    expect(table.content[0].content.length).toBe(1)
  })
  it('row/column commands outside a table are safe no-ops (doc unchanged)', () => {
    const ed = makeEditor({ type: 'doc', content: [para('plain')] })
    const before = JSON.stringify(ed.getJSON())
    ed.commands.setTextSelection(1)
    expect(ed.commands.addRowBefore()).toBe(false)
    expect(ed.commands.deleteRow()).toBe(false)
    expect(ed.commands.deleteColumn()).toBe(false)
    expect(JSON.stringify(ed.getJSON())).toBe(before)
  })
  it('toggleHeaderRow converts the first row to header cells', () => {
    const ed = makeEditor(tableDoc([row([cell('a'), cell('b')]), row([cell('c'), cell('d')])]))
    cursorInFirstCell(ed)
    expect(ed.commands.toggleHeaderRow()).toBe(true)
    const table = (ed.getJSON() as any).content[0]
    expect(table.content[0].content.map((c: any) => c.type)).toEqual(['tableHeader', 'tableHeader'])
    expect(table.content[1].content.map((c: any) => c.type)).toEqual(['tableCell', 'tableCell'])
  })
})

describe('tables Pro: cell alignment, selection, resize attrs, RTL, undo', () => {
  it('setTextAlign inside a cell aligns that cell paragraph', () => {
    const ed = makeEditor(simpleDoc())
    // cursorInFirstCell lands in the first tableCell ('a', second row),
    // not the header row — so assert on that cell's paragraph.
    cursorInFirstCell(ed)
    expect(ed.commands.setTextAlign('center')).toBe(true)
    const table = (ed.getJSON() as any).content[0]
    expect(table.content[1].content[0].content[0].attrs.textAlign).toBe('center')
  })
  it('a cell-range selection survives and deleteRow still works on it', () => {
    const ed = makeEditor(simpleDoc())
    // Cell start positions: first cell at its node pos, second cell likewise.
    const cellPositions: number[] = []
    ed.state.doc.descendants((n: any, pos: number) => { if (n.type.name === 'tableCell' || n.type.name === 'tableHeader') cellPositions.push(pos) })
    expect(cellPositions.length).toBeGreaterThanOrEqual(2)
    expect(ed.commands.setCellSelection({ anchorCell: cellPositions[0], headCell: cellPositions[1] })).toBe(true)
    expect((ed.state.selection as any).constructor.name).toBe('CellSelection')
    expect(ed.commands.deleteRow()).toBe(true)
    expect((ed.getJSON() as any).content[0].content.length).toBe(1)
  })
  it('colWidth attrs persist through a getJSON round-trip (resizable table proof)', () => {
    const ed = makeEditor(tableDoc([row([cell('a', { colwidth: [120] }), cell('b', { colwidth: [180] })])]))
    const json = ed.getJSON() as any
    expect(json.content[0].content[0].content.map((c: any) => c.attrs.colwidth)).toEqual([[120], [180]])
    const reopened = makeEditor(json)
    expect((reopened.getJSON() as any).content[0].content[0].content.map((c: any) => c.attrs.colwidth)).toEqual([[120], [180]])
  })
  it('a table inside an RTL document keeps dir rtl', () => {
    const ed = makeEditor(simpleDoc(), { editorProps: { attributes: { dir: 'rtl' } } })
    expect(ed.view.dom.getAttribute('dir')).toBe('rtl')
    expect(ed.getHTML()).toContain('<table')
  })
  it('insert-table → add-row → undo twice returns to the pre-table doc', async () => {
    const ed = makeEditor({ type: 'doc', content: [para('before')] })
    const before = JSON.stringify(ed.getJSON())
    ed.commands.setTextSelection(1)
    expect(ed.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true })).toBe(true)
    // ProseMirror history groups steps issued within its 500 ms window
    // into ONE undo step (verified: a synchronous pair undoes in one
    // call). Waiting past that window keeps the two edits as two steps,
    // which is also what a real user experiences between separate actions.
    await new Promise((r) => setTimeout(r, 600))
    cursorInFirstCell(ed)
    expect(ed.commands.addRowAfter()).toBe(true)
    expect(ed.commands.undo()).toBe(true)
    expect(ed.commands.undo()).toBe(true)
    expect(JSON.stringify(ed.getJSON())).toBe(before)
  })
})
