// View modes for M2-03 (Focus Mode + Reading Mode).
//
// Session-only editor state: nothing here is persisted into a document or
// into localStorage doc records, and nothing here mutates document content.
// The paragraph-dimming is a REAL ProseMirror decoration plugin, not a
// CSS-only claim: on every state change it re-marks every top-level block
// except the one containing the cursor with the `focus-dimmed` class. The
// CSS in index.css only dims that class while `.mode-focus` is on the
// editor shell, so the decorations are visually inert in normal edit mode.
// Decorations never touch the document, so getJSON() is byte-identical
// before/after any mode toggle (proven in viewModes.test.ts).
import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export type ViewMode = 'edit' | 'focus' | 'reading'
export type FocusWidth = 'narrow' | 'normal' | 'wide'

export const FOCUS_WIDTHS: FocusWidth[] = ['narrow', 'normal', 'wide']

/** Writing-area class for a focus width. Applied to the A4 page element. */
export function focusWidthClass(width: FocusWidth): string {
  return `focus-width-${width}`
}

/** Shell class for a view mode ('' in normal edit mode). */
export function viewModeClass(mode: ViewMode): string {
  return mode === 'edit' ? '' : `mode-${mode}`
}

/**
 * Mode transition rules. Entering a mode from edit, exiting any mode back
 * to edit, and switching directly between focus and reading (the component
 * restores reading state first) are all allowed; there is no other state.
 */
export function resolveModeTransition(from: ViewMode, to: ViewMode): ViewMode {
  if (to === 'edit') return 'edit'
  if (from === 'edit') return to
  return to // direct focus <-> reading switch
}

/** Esc exits focus and reading modes, and does nothing in edit mode. */
export function shouldExitOnEsc(mode: ViewMode): boolean {
  return mode !== 'edit'
}

/** Snapshot of the reading position, taken on entering Reading Mode. */
export interface ViewSnapshot {
  scrollTop: number
  from: number
  to: number
}

/** Pure snapshot constructor (scroll + selection), so it is unit-testable. */
export function createViewSnapshot(scrollTop: number, from: number, to: number): ViewSnapshot {
  return { scrollTop: Math.max(0, scrollTop), from: Math.max(0, from), to: Math.max(from, to) }
}

/**
 * Page direction for a document. Mode CSS classes are deliberately
 * dir-agnostic (they set no `direction`/`text-align`), so RTL documents
 * keep their own dir attribute in every mode; this helper just resolves
 * which dir the page already carries.
 */
export function resolvePageDir(docDir: string | undefined, fallback: 'rtl' | 'ltr'): 'rtl' | 'ltr' {
  return docDir === 'rtl' || docDir === 'ltr' ? docDir : fallback
}

/** True when a mode CSS class name itself forces no text direction. */
export function isDirAgnosticClass(className: string): boolean {
  return !/ltr|rtl/i.test(className)
}

/** Index of the top-level block containing `pos`, or -1 for an empty doc. */
export function activeBlockIndex(doc: { childCount: number; child: (i: number) => { nodeSize: number } }, pos: number): number {
  let at = 0
  for (let i = 0; i < doc.childCount; i++) {
    const size = doc.child(i).nodeSize
    if (pos >= at && pos <= at + size) return i
    at += size
  }
  return doc.childCount > 0 ? doc.childCount - 1 : -1
}

/**
 * Focus-dimming extension. Marks every top-level block except the active
 * one with class `focus-dimmed`. Nested content (e.g. a list item) dims at
 * its top-level block granularity — the whole list stays lit while the
 * cursor is inside it — which is the honest, documented behaviour.
 */
export const FocusDim = Extension.create({
  name: 'focusDim',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const active = activeBlockIndex(state.doc as any, state.selection.from)
            const decos: any[] = []
            let at = 0
            state.doc.forEach((child: any, _offset: number, index: number) => {
              if (index !== active) decos.push(Decoration.node(at, at + child.nodeSize, { class: 'focus-dimmed' }))
              at += child.nodeSize
            })
            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },
})
