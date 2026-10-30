import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import {
  FocusDim, FOCUS_WIDTHS, activeBlockIndex, createViewSnapshot, focusWidthClass,
  isDirAgnosticClass, resolveModeTransition, resolvePageDir, shouldExitOnEsc,
  viewModeClass,
} from './viewModes'

// Pure-logic tests for M2-03 (Focus Mode + Reading Mode).
describe('viewModes pure logic', () => {
  it('width options map to distinct CSS classes', () => {
    expect(FOCUS_WIDTHS).toEqual(['narrow', 'normal', 'wide'])
    expect(focusWidthClass('narrow')).toBe('focus-width-narrow')
    expect(focusWidthClass('normal')).toBe('focus-width-normal')
    expect(focusWidthClass('wide')).toBe('focus-width-wide')
  })
  it('mode transitions: edit -> focus -> edit and edit -> reading -> edit', () => {
    expect(resolveModeTransition('edit', 'focus')).toBe('focus')
    expect(resolveModeTransition('focus', 'edit')).toBe('edit')
    expect(resolveModeTransition('edit', 'reading')).toBe('reading')
    expect(resolveModeTransition('reading', 'edit')).toBe('edit')
  })
  it('direct focus <-> reading switch is allowed (component restores reading state first)', () => {
    expect(resolveModeTransition('focus', 'reading')).toBe('reading')
    expect(resolveModeTransition('reading', 'focus')).toBe('focus')
  })
  it('Esc exits focus and reading, but not edit mode', () => {
    expect(shouldExitOnEsc('focus')).toBe(true)
    expect(shouldExitOnEsc('reading')).toBe(true)
    expect(shouldExitOnEsc('edit')).toBe(false)
  })
  it('view snapshot clamps scroll and keeps from <= to', () => {
    const s = createViewSnapshot(-5, 10, 4)
    expect(s.scrollTop).toBe(0)
    expect(s.from).toBe(10)
    expect(s.to).toBe(10)
    expect(createViewSnapshot(120, 3, 9)).toEqual({ scrollTop: 120, from: 3, to: 9 })
  })
  it('active block index resolves the block containing the cursor', () => {
    const doc = { childCount: 3, child: (i: number) => ({ nodeSize: [7, 8, 7][i] }) }
    expect(activeBlockIndex(doc, 2)).toBe(0)
    expect(activeBlockIndex(doc, 9)).toBe(1)
    expect(activeBlockIndex(doc, 20)).toBe(2)
  })
  it('RTL: mode and width classes force no text direction; doc dir wins', () => {
    for (const cls of [viewModeClass('focus'), viewModeClass('reading'), ...FOCUS_WIDTHS.map(focusWidthClass)]) {
      expect(isDirAgnosticClass(cls), cls).toBe(true)
    }
    expect(resolvePageDir('rtl', 'ltr')).toBe('rtl')
    expect(resolvePageDir('ltr', 'rtl')).toBe('ltr')
    expect(resolvePageDir(undefined, 'rtl')).toBe('rtl')
  })
})

// Headless-editor tests with the real extension stack (same pattern as
// lineheight.test.ts). These prove the component-level contracts that are
// unit-testable: JSON identity across mode toggles, editable toggling for
// Reading Mode, and the real ProseMirror dimming decorations for Focus Mode.
// Visual rendering (exact dim opacity, page layout) is NOT unit-testable
// and is honestly left to on-device/browser eyeballing.
const editors: Editor[] = []
function makeEditor(content: any, withFocusDim = true) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const ed = new Editor({ element, extensions: withFocusDim ? [StarterKit, FocusDim] : [StarterKit], content })
  editors.push(ed)
  return ed
}
afterEach(() => { while (editors.length) editors.pop()!.destroy() })

const THREE_PARAS = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Third' }] },
  ],
}

describe('viewModes headless editor', () => {
  it('entering/exiting reading mode (editable false -> true) leaves JSON byte-identical', () => {
    const ed = makeEditor(JSON.parse(JSON.stringify(THREE_PARAS)), false)
    const before = JSON.stringify(ed.getJSON())
    ed.setEditable(false)
    expect(ed.isEditable).toBe(false)
    ed.setEditable(true)
    expect(ed.isEditable).toBe(true)
    expect(JSON.stringify(ed.getJSON())).toBe(before)
  })
  it('entering/exiting focus mode (selection moves + decorations) leaves JSON byte-identical', () => {
    const ed = makeEditor(JSON.parse(JSON.stringify(THREE_PARAS)))
    const before = JSON.stringify(ed.getJSON())
    const firstSize = (ed.state.doc.firstChild as any).nodeSize
    ed.commands.setTextSelection(firstSize + 2) // inside "Second"
    ed.commands.setTextSelection(2) // back inside "First"
    expect(JSON.stringify(ed.getJSON())).toBe(before)
  })
  it('focus dimming really marks non-active paragraphs via ProseMirror decorations', () => {
    const ed = makeEditor(JSON.parse(JSON.stringify(THREE_PARAS)))
    const firstSize = (ed.state.doc.firstChild as any).nodeSize
    ed.commands.setTextSelection(firstSize + 2) // cursor inside "Second"
    const paras = ed.view.dom.querySelectorAll('p')
    expect(paras.length).toBe(3)
    expect(paras[1].classList.contains('focus-dimmed')).toBe(false)
    expect(paras[0].classList.contains('focus-dimmed')).toBe(true)
    expect(paras[2].classList.contains('focus-dimmed')).toBe(true)
  })
  it('moving the cursor moves the undimmed paragraph with it', () => {
    const ed = makeEditor(JSON.parse(JSON.stringify(THREE_PARAS)))
    ed.commands.setTextSelection(2) // inside "First"
    const paras = ed.view.dom.querySelectorAll('p')
    expect(paras[0].classList.contains('focus-dimmed')).toBe(false)
    expect(paras[1].classList.contains('focus-dimmed')).toBe(true)
  })
})
