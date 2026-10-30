import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { extractLiveHeadings } from './headings'
import {
  sectionRange, levelSkipWarnings, planSectionMove,
  setHeadingLevel, selectSection, moveSection,
  SectionCollapse, isSectionCollapsed, collapseSection, expandSection,
} from './sections'

// Headings as LiveHeading-shaped fixtures (positions are illustrative;
// the pure functions only use level/from/to ordering).
const h = (level: number, from: number, to: number, text = '') => ({ level, text, empty: text === '', from, to, contentPos: from + 1 })

describe('sectionRange (pure)', () => {
  it('section ends before the next equal-or-higher heading, subsections included', () => {
    const hs = [h(1, 0, 7, 'One'), h(2, 7, 14, 'Sub'), h(1, 30, 37, 'Two')]
    expect(sectionRange(hs, 0, 50)).toEqual({ index: 0, from: 0, to: 30, lastHeadingIndex: 1 })
    expect(sectionRange(hs, 1, 50)).toEqual({ index: 1, from: 7, to: 30, lastHeadingIndex: 1 })
    expect(sectionRange(hs, 2, 50)).toEqual({ index: 2, from: 30, to: 50, lastHeadingIndex: 2 })
  })
  it('empty list, bad index, single heading, heading at doc end', () => {
    expect(sectionRange([], 0, 10)).toBeNull()
    expect(sectionRange([h(1, 0, 5)], 3, 10)).toBeNull()
    expect(sectionRange([h(1, 0, 5)], 0, 10)).toEqual({ index: 0, from: 0, to: 10, lastHeadingIndex: 0 })
    // Heading at doc end: its range is just itself.
    expect(sectionRange([h(1, 0, 5), h(2, 5, 12)], 1, 12)).toEqual({ index: 1, from: 5, to: 12, lastHeadingIndex: 1 })
  })
})

describe('levelSkipWarnings (pure)', () => {
  it('H1 -> H3 flagged, H1 -> H2 not, going shallower never flagged, first heading never flagged', () => {
    const hs = [h(3, 0, 5), h(1, 5, 10), h(2, 10, 15), h(4, 15, 20), h(1, 20, 25), h(3, 25, 30)]
    // Index 0 (first, H3): no warning. 1->2 ok. 2->4 skips: warn. 4->1 ok. 1->3 skips: warn.
    expect(levelSkipWarnings(hs)).toEqual([
      { index: 3, level: 4, prevLevel: 2 },
      { index: 5, level: 3, prevLevel: 1 },
    ])
  })
  it('no warnings for a clean ladder or an empty list', () => {
    expect(levelSkipWarnings([h(1, 0, 5), h(2, 5, 10), h(3, 10, 15), h(2, 15, 20), h(1, 20, 25)])).toEqual([])
    expect(levelSkipWarnings([])).toEqual([])
  })
})

describe('planSectionMove (pure)', () => {
  // Layout: H1 A [0,30) incl. H2 sub [10,30) ; H1 B [30,50) ; H1 C [50,70)
  const hs = [h(1, 0, 10, 'A'), h(2, 10, 20, 'A-sub'), h(1, 30, 40, 'B'), h(1, 50, 60, 'C')]
  it('first section to end, last section to top', () => {
    expect(planSectionMove(hs, 70, 0, 3, 'after')).toEqual({ srcFrom: 0, srcTo: 30, insertPos: 70 })
    expect(planSectionMove(hs, 70, 3, 0, 'before')).toEqual({ srcFrom: 50, srcTo: 70, insertPos: 0 })
  })
  it('move with subsections carries the whole section range', () => {
    expect(planSectionMove(hs, 70, 0, 3, 'before')).toEqual({ srcFrom: 0, srcTo: 30, insertPos: 50 })
    // 'before' the section right after the source is a no-op (already there).
    expect(planSectionMove(hs, 70, 0, 2, 'before')).toBeNull()
  })
  it('rejects moving into itself (target is a subsection of the source)', () => {
    expect(planSectionMove(hs, 70, 0, 1, 'before')).toBeNull()
    expect(planSectionMove(hs, 70, 0, 1, 'after')).toBeNull()
    expect(planSectionMove(hs, 70, 0, 1, 'child')).toBeNull()
  })
  it('rejects no-op moves', () => {
    expect(planSectionMove(hs, 70, 0, 0, 'before')).toBeNull()
    expect(planSectionMove(hs, 70, 2, 3, 'before')).toBeNull() // B already before C
    expect(planSectionMove(hs, 70, 2, 0, 'after')).toBeNull() // after A-section == B's start... A ends at 30 == B start
  })
  it('child move: only deeper heading into a single-heading target section', () => {
    // A-sub (H2) into B (H1, single-heading section): insert at B's end.
    expect(planSectionMove(hs, 70, 1, 2, 'child')).toEqual({ srcFrom: 10, srcTo: 30, insertPos: 50 })
    // Not deeper: B (H1) into A-sub (H2) rejected.
    expect(planSectionMove(hs, 70, 2, 1, 'child')).toBeNull()
    // Target section with subsections rejected: moving C into A (A has a sub).
    expect(planSectionMove(hs, 70, 3, 0, 'child')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Headless-editor tests (real ProseMirror doc + real undo history).
// ---------------------------------------------------------------------------

const editors: Editor[] = []
function makeEditor(content: any) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const ed = new Editor({ element, extensions: [StarterKit, SectionCollapse], content })
  editors.push(ed)
  // Normalise the stock StarterKit trailing-node behaviour up front: a
  // document not ending in a paragraph gains an empty trailing paragraph
  // on its first transaction. Dispatching one empty transaction here makes
  // every baseline below include it, so op assertions compare like with
  // like (the real editor behaves identically on first edit).
  ed.view.dispatch(ed.state.tr)
  return ed
}
afterEach(() => { while (editors.length) editors.pop()!.destroy() })

const P = (text: string) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : undefined })
const H = (level: number, text: string) => ({ type: 'heading', attrs: { level }, content: text ? [{ type: 'text', text }] : undefined })
const docJson = (blocks: any[]) => ({ type: 'doc', content: blocks })

/** Top-level block texts in document order. */
function blockTexts(ed: Editor): string[] {
  const json = ed.getJSON() as any
  return (json.content || []).map((n: any) =>
    (n.content || []).map((c: any) => c.text || '').join(''))
}

function docWithSections() {
  return makeEditor(docJson([
    H(1, 'فصل یک'),
    P('متن بخش یک'),
    H(2, 'زیربخش'),
    P('متن زیربخش'),
    H(1, 'Chapter Two'),
    P('Second body'),
    H(1, 'پایان'),
  ]))
}

describe('setHeadingLevel (editor)', () => {
  it('changes level, converts to paragraph, keeps FA/ZWNJ + mixed text, single undo restores', () => {
    const ed = makeEditor(docJson([
      H(2, 'می\u200Cخواهم بنویسم and English'),
      P('body'),
    ]))
    let hs = extractLiveHeadings(ed.state.doc)
    expect(setHeadingLevel(ed, hs[0], 1)).toBe(true)
    hs = extractLiveHeadings(ed.state.doc)
    expect(hs[0].level).toBe(1)
    expect(hs[0].text).toBe('می\u200Cخواهم بنویسم and English')
    expect(ed.commands.undo()).toBe(true)
    hs = extractLiveHeadings(ed.state.doc)
    expect(hs[0].level).toBe(2)
    // Convert to paragraph: heading disappears, text stays.
    expect(setHeadingLevel(ed, hs[0], null)).toBe(true)
    expect(extractLiveHeadings(ed.state.doc)).toEqual([])
    expect(blockTexts(ed)[0]).toBe('می\u200Cخواهم بنویسم and English')
    expect(ed.commands.undo()).toBe(true)
    expect(extractLiveHeadings(ed.state.doc)[0].level).toBe(2)
  })
  it('rejects invalid levels and non-heading positions without changing the doc', () => {
    const ed = docWithSections()
    const before = ed.getJSON()
    const hs = extractLiveHeadings(ed.state.doc)
    expect(setHeadingLevel(ed, hs[0], 7)).toBe(false)
    expect(setHeadingLevel(ed, hs[0], 0)).toBe(false)
    expect(ed.getJSON()).toEqual(before)
  })
})

describe('selectSection (editor)', () => {
  it('selects heading + body + subsections, excluding the next section', () => {
    const ed = docWithSections()
    const hs = extractLiveHeadings(ed.state.doc)
    const docEnd = ed.state.doc.content.size
    expect(selectSection(ed, hs, 0, docEnd)).toBe(true)
    const sel = ed.state.selection
    expect(ed.state.doc.textBetween(sel.from, sel.to, '\n')).toBe(
      'فصل یک\nمتن بخش یک\nزیربخش\nمتن زیربخش')
    // Second section (Chapter Two, index 2) selects only itself.
    expect(selectSection(ed, hs, 2, docEnd)).toBe(true)
    const sel2 = ed.state.selection
    expect(ed.state.doc.textBetween(sel2.from, sel2.to, '\n')).toBe('Chapter Two\nSecond body')
  })
  it('heading at doc end selects just itself; empty doc selects nothing', () => {
    const ed = docWithSections()
    const hs = extractLiveHeadings(ed.state.doc)
    expect(selectSection(ed, hs, 3, ed.state.doc.content.size)).toBe(true)
    // The trailing empty paragraph (stock StarterKit behaviour) is part of
    // the last section's range, so the selected text ends with its separator.
    expect(ed.state.doc.textBetween(ed.state.selection.from, ed.state.selection.to, '\n').trim()).toBe('پایان')
    const empty = makeEditor(docJson([P('')]))
    expect(selectSection(empty, extractLiveHeadings(empty.state.doc), 0, empty.state.doc.content.size)).toBe(false)
  })
})

describe('moveSection (editor)', () => {
  it('moves first section to end: neighbours untouched, nothing lost or duplicated', () => {
    const ed = docWithSections()
    const before = blockTexts(ed)
    const hs = extractLiveHeadings(ed.state.doc)
    expect(moveSection(ed, hs, ed.state.doc.content.size, 0, 3, 'after')).toBe(true)
    expect(blockTexts(ed)).toEqual([
      'Chapter Two', 'Second body', 'پایان', '',
      'فصل یک', 'متن بخش یک', 'زیربخش', 'متن زیربخش',
    ])
    // Single undo restores the original exactly.
    expect(ed.commands.undo()).toBe(true)
    expect(blockTexts(ed)).toEqual(before)
    expect(ed.commands.redo()).toBe(true)
    expect(blockTexts(ed)[0]).toBe('Chapter Two')
    expect(ed.commands.undo()).toBe(true)
  })
  it('moves last section to top and moves a section with subsections as one block', () => {
    const ed = docWithSections()
    let hs = extractLiveHeadings(ed.state.doc)
    expect(moveSection(ed, hs, ed.state.doc.content.size, 3, 0, 'before')).toBe(true)
    expect(blockTexts(ed)[0]).toBe('پایان')
    expect(ed.commands.undo()).toBe(true)
    // Move the middle section (Chapter Two, no subsections) before فصل یک.
    hs = extractLiveHeadings(ed.state.doc)
    expect(moveSection(ed, hs, ed.state.doc.content.size, 2, 0, 'before')).toBe(true)
    expect(blockTexts(ed)).toEqual([
      'Chapter Two', 'Second body',
      'فصل یک', 'متن بخش یک', 'زیربخش', 'متن زیربخش', 'پایان', '',
    ])
  })
  it('move-down one step = after the next section (the nav-pane ↓ button path)', () => {
    // Regression for a parent-verification catch: ↓ used to move "before"
    // the next heading, which planSectionMove rightly rejects as a no-op.
    const ed = docWithSections()
    const hs = extractLiveHeadings(ed.state.doc)
    // Headings: 0=فصل یک, 1=زیربخش (its subsection), 2=Chapter Two — so
    // the "next section" is index 2, exactly as the pane computes it
    // (lastHeadingIndex + 1).
    expect(moveSection(ed, hs, ed.state.doc.content.size, 0, 2, 'after')).toBe(true)
    expect(blockTexts(ed)).toEqual([
      'Chapter Two', 'Second body',
      'فصل یک', 'متن بخش یک', 'زیربخش', 'متن زیربخش', 'پایان', '',
    ])
    expect(ed.commands.undo()).toBe(true)
    expect(blockTexts(ed)[0]).toBe('فصل یک')
  })
  it('rejects moving into itself and no-op moves without touching the doc', () => {
    const ed = docWithSections()
    const before = ed.getJSON()
    const hs = extractLiveHeadings(ed.state.doc)
    expect(moveSection(ed, hs, ed.state.doc.content.size, 0, 1, 'before')).toBe(false)
    expect(moveSection(ed, hs, ed.state.doc.content.size, 0, 0, 'before')).toBe(false)
    expect(moveSection(ed, hs, ed.state.doc.content.size, 0, 2, 'before')).toBe(false)
    expect(ed.getJSON()).toEqual(before)
  })
  it('child move inserts a deeper section at the end of a single-heading target section', () => {
    const ed2 = makeEditor(docJson([
      H(1, 'Target'), P('target body'),
      H(1, 'Middle'), P('middle body'),
      H(2, 'Child'), P('child body'),
    ]))
    const hs2 = extractLiveHeadings(ed2.state.doc)
    expect(moveSection(ed2, hs2, ed2.state.doc.content.size, 2, 0, 'child')).toBe(true)
    expect(blockTexts(ed2)).toEqual([
      'Target', 'target body', 'Child', 'child body', 'Middle', 'middle body',
    ])
    expect(ed2.commands.undo()).toBe(true)
    expect(blockTexts(ed2)).toEqual([
      'Target', 'target body', 'Middle', 'middle body', 'Child', 'child body',
    ])
  })
})

describe('section collapse (decoration-only)', () => {
  it('hides body blocks, leaves JSON identical, expanding restores exactly', () => {
    const ed = docWithSections()
    const hs = extractLiveHeadings(ed.state.doc)
    const docEnd = ed.state.doc.content.size
    const jsonBefore = ed.getJSON()
    expect(isSectionCollapsed(ed, hs, 0, docEnd)).toBe(false)
    expect(collapseSection(ed, hs, 0, docEnd)).toBe(true)
    expect(isSectionCollapsed(ed, hs, 0, docEnd)).toBe(true)
    expect(ed.getJSON()).toEqual(jsonBefore)
    // Body blocks of section 0: 2 paragraphs (its subsection heading stays visible).
    expect(ed.view.dom.querySelectorAll('.section-hidden').length).toBe(2)
    expect(expandSection(ed, hs, 0, docEnd)).toBe(true)
    expect(isSectionCollapsed(ed, hs, 0, docEnd)).toBe(false)
    expect(ed.view.dom.querySelectorAll('.section-hidden').length).toBe(0)
    expect(ed.getJSON()).toEqual(jsonBefore)
  })
  it('a section whose body is headings only has nothing to hide', () => {
    const ed = makeEditor(docJson([H(1, 'A'), H(2, 'Sub'), H(1, 'B'), P('b body')]))
    const hs = extractLiveHeadings(ed.state.doc)
    const docEnd = ed.state.doc.content.size
    // Section 0's body is just the H2 heading — no non-heading block to hide.
    expect(collapseSection(ed, hs, 0, docEnd)).toBe(false)
    expect(ed.view.dom.querySelectorAll('.section-hidden').length).toBe(0)
    // Section B has a paragraph body and collapses normally.
    expect(collapseSection(ed, hs, 2, docEnd)).toBe(true)
    expect(ed.view.dom.querySelectorAll('.section-hidden').length).toBe(1)
  })
  it('heading at doc end has no body to collapse; collapse survives undo of another edit', () => {
    const ed = docWithSections()
    const hs = extractLiveHeadings(ed.state.doc)
    const docEnd = ed.state.doc.content.size
    expect(collapseSection(ed, hs, 4, docEnd)).toBe(false)
    // Collapse section 0, edit elsewhere, undo: content is never lost.
    expect(collapseSection(ed, hs, 0, docEnd)).toBe(true)
    const jsonBefore = ed.getJSON()
    ed.chain().setTextSelection(ed.state.doc.content.size - 1).insertContent('X').run()
    expect(ed.commands.undo()).toBe(true)
    expect(ed.getJSON()).toEqual(jsonBefore)
    const hs2 = extractLiveHeadings(ed.state.doc)
    expect(isSectionCollapsed(ed, hs2, 0, ed.state.doc.content.size)).toBe(true)
    expect(expandSection(ed, hs2, 0, ed.state.doc.content.size)).toBe(true)
    expect(ed.getJSON()).toEqual(jsonBefore)
  })
})
