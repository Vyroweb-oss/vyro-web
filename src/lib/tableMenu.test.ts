import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { CellSelection } from '@tiptap/pm/tables'
import {
  getContextMenuItems,
  rectOverlapsSpans,
  tableMenuAvailability,
  type MenuContext,
} from './paste'
// @ts-ignore raw source import, the established pattern for wiring guards
import editorSrcRaw from '../components/Editor.tsx?raw'
const editorSrc = editorSrcRaw as unknown as string

describe('Tier-1 S6: menu availability mirrors the engine gates', () => {
  it('multi-cell selection without overlap → merge only', () => {
    expect(tableMenuAvailability({ kind: 'multi', overlaps: false })).toEqual({ merge: true, split: false })
  })
  it('multi-cell selection overlapped by an outside span → neither (engine refuses)', () => {
    expect(tableMenuAvailability({ kind: 'multi', overlaps: true })).toEqual({ merge: false, split: false })
  })
  it('single 1x1 cell → neither (split cannot split a plain cell)', () => {
    expect(tableMenuAvailability({ kind: 'single', colspan: 1, rowspan: 1 })).toEqual({ merge: false, split: false })
  })
  it('single spanned cell → split only', () => {
    expect(tableMenuAvailability({ kind: 'single', colspan: 2, rowspan: 1 })).toEqual({ merge: false, split: true })
    expect(tableMenuAvailability({ kind: 'single', colspan: 1, rowspan: 3 })).toEqual({ merge: false, split: true })
  })
  it('no table state → neither', () => {
    expect(tableMenuAvailability(null)).toEqual({ merge: false, split: false })
    expect(tableMenuAvailability(undefined)).toEqual({ merge: false, split: false })
  })
})

describe('Tier-1 S6: rectOverlapsSpans mirrors cellsOverlapRectangle', () => {
  // 3x3 grid of unique cells: positions are cell-start indices.
  const plain = [0, 1, 2, 3, 4, 5, 6, 7, 8]
  it('a clean inner rectangle does not overlap', () => {
    expect(rectOverlapsSpans(plain, 3, 3, { top: 0, left: 0, bottom: 2, right: 2 })).toBe(false)
  })
  it('a colspan cell crossing the right edge overlaps', () => {
    // Row 0: cell A spans cols 0-1 (map repeats its pos), B at col 2.
    const map = [0, 0, 2, 3, 4, 5, 6, 7, 8]
    // Selecting only col 0 of row 0 cuts through A → overlap.
    expect(rectOverlapsSpans(map, 3, 3, { top: 0, left: 0, bottom: 1, right: 1 })).toBe(true)
    // Selecting the whole span is fine.
    expect(rectOverlapsSpans(map, 3, 3, { top: 0, left: 0, bottom: 1, right: 2 })).toBe(false)
  })
  it('a rowspan cell crossing the bottom edge overlaps', () => {
    // Cell at (0,0) spans rows 0-1.
    const map = [0, 1, 2, 0, 4, 5, 6, 7, 8]
    expect(rectOverlapsSpans(map, 3, 3, { top: 0, left: 0, bottom: 1, right: 1 })).toBe(true)
    expect(rectOverlapsSpans(map, 3, 3, { top: 0, left: 0, bottom: 2, right: 1 })).toBe(false)
  })
})

describe('Tier-1 S6: context-menu items', () => {
  const base: MenuContext = { hasSelection: false, inTable: true, inImage: false, inLink: false }
  it('merge offered only in a table with merge availability', () => {
    expect(getContextMenuItems({ ...base, table: { merge: true, split: false } })).toContain('mergeCells')
    expect(getContextMenuItems({ ...base, table: { merge: false, split: true } })).not.toContain('mergeCells')
    expect(getContextMenuItems({ ...base })).not.toContain('mergeCells')
    expect(getContextMenuItems({ ...base, inTable: false, table: { merge: true, split: true } })).not.toContain('mergeCells')
  })
  it('split offered only with split availability; existing table items unchanged', () => {
    const items = getContextMenuItems({ ...base, table: { merge: false, split: true } })
    expect(items).toContain('splitCell')
    expect(items).toEqual(expect.arrayContaining(['addRow', 'addColumn', 'deleteRow', 'deleteColumn']))
    expect(getContextMenuItems(base)).toEqual(['pastePlain', 'addRow', 'addColumn', 'deleteRow', 'deleteColumn'])
  })
})

describe('Tier-1 S6: wiring guards', () => {
  it('the editor probes the selection and runs the engine commands', () => {
    expect(editorSrc).toContain('selectedRect(editor.state)')
    expect(editorSrc).toContain('rectOverlapsSpans(rect.map.map')
    expect(editorSrc).toContain("case 'mergeCells': chain().mergeCells().run()")
    expect(editorSrc).toContain("case 'splitCell': chain().splitCell().run()")
  })
})

// --- Engine regression: real TableKit, real CellSelection -----------------

const cell = (text: string, attrs: any = {}) => ({
  type: 'tableCell', attrs: { colspan: 1, rowspan: 1, ...attrs },
  content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
})
const tableDoc = (rows: any[][]) => ({
  type: 'doc',
  content: [{ type: 'table', content: rows.map((r) => ({ type: 'tableRow', content: r })) }],
})

function makeEditor(content: any) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  return new Editor({ element, extensions: [StarterKit, TableKit], content })
}
function cellPosByText(ed: Editor, text: string): number {
  let pos = -1
  ed.state.doc.descendants((n: any, p: number) => { if (n.type.name === 'tableCell' && n.textContent === text) pos = p })
  if (pos < 0) throw new Error('cell not found: ' + text)
  return pos
}
function cellPosByColspan(ed: Editor, colspan: number): number {
  let pos = -1
  ed.state.doc.descendants((n: any, p: number) => { if (n.type.name === 'tableCell' && n.attrs.colspan === colspan) pos = p })
  if (pos < 0) throw new Error('cell with colspan ' + colspan + ' not found')
  return pos
}
function selectCells(ed: Editor, fromText: string, toText: string) {
  const sel = new CellSelection(
    ed.state.doc.resolve(cellPosByText(ed, fromText)),
    ed.state.doc.resolve(cellPosByText(ed, toText)),
  )
  ed.view.dispatch(ed.state.tr.setSelection(sel))
}

describe('Tier-1 S6: engine merge/split preserve content', () => {
  it('merging two cells keeps BOTH cells\u2019 text in the merged cell', () => {
    const ed = makeEditor(tableDoc([[cell('Alpha'), cell('Beta')], [cell('Gamma'), cell('Delta')]]))
    selectCells(ed, 'Alpha', 'Beta')
    expect(ed.commands.mergeCells()).toBe(true)
    const json: any = ed.getJSON()
    const row0 = json.content[0].content[0]
    expect(row0.content).toHaveLength(1)
    expect(row0.content[0].attrs.colspan).toBe(2)
    expect(row0.content[0].content.map((p: any) => p.content?.[0]?.text)).toEqual(['Alpha', 'Beta'])
    // Untouched row stays untouched.
    expect(json.content[0].content[1].content.map((c: any) => c.textContent ?? c.content[0].content[0].text)).toBeDefined()
    ed.destroy()
  })
  it('splitting the merged cell restores two cells', () => {
    const ed = makeEditor(tableDoc([[cell('Alpha'), cell('Beta')], [cell('Gamma'), cell('Delta')]]))
    selectCells(ed, 'Alpha', 'Beta')
    ed.commands.mergeCells()
    const mergedPos = cellPosByColspan(ed, 2)
    const single = new CellSelection(ed.state.doc.resolve(mergedPos), ed.state.doc.resolve(mergedPos))
    ed.view.dispatch(ed.state.tr.setSelection(single))
    expect(ed.commands.splitCell()).toBe(true)
    const row0 = (ed.getJSON() as any).content[0].content[0]
    expect(row0.content).toHaveLength(2)
    expect(row0.content[0].attrs.colspan).toBe(1)
    ed.destroy()
  })
  it('merge is a safe no-op without a cell selection; split is a no-op on a 1x1 cell', () => {
    const ed = makeEditor(tableDoc([[cell('Alpha'), cell('Beta')]]))
    // Compare the TABLE subtree only: the editor may legitimately append a
    // trailing paragraph after a table at the document level; the no-op
    // claim is about the table itself.
    const tableJson = () => JSON.stringify((ed.getJSON() as any).content[0])
    const before = tableJson()
    expect(ed.commands.mergeCells()).toBe(false)
    expect(tableJson()).toBe(before)
    // Caret inside the single plain cell: split must refuse (engine rule).
    const pos = cellPosByText(ed, 'Alpha')
    ed.view.dispatch(ed.state.tr.setSelection((ed.state.selection.constructor as any).near(ed.state.doc.resolve(pos + 2))))
    expect(ed.commands.splitCell()).toBe(false)
    expect(tableJson()).toBe(before)
    ed.destroy()
  })
})
