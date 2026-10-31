// Pagination decorations (Pagination mission, owner 2026-10-31).
//
// The editor stays a single ProseMirror document — content, undo, find,
// compare and saving are untouched. Visual pagination is a decoration
// layer: a measured spacer widget is inserted at each page-start position
// so the following block begins exactly at the top of the next sheet.
// Spacers are decorations only: they are never part of the document JSON,
// never saved, and are hidden when printing (the printer paginates the
// same flow with the document's real @page size and margins).

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface SpacerSpec {
  /** Document position the spacer sits at (start of the block beginning a page). */
  pos: number
  height: number
}

export const paginationKey = new PluginKey<SpacerSpec[]>('vyroPagination')

export const PaginationExtension = Extension.create({
  name: 'vyroPagination',
  addProseMirrorPlugins() {
    return [
      new Plugin<SpacerSpec[]>({
        key: paginationKey,
        state: {
          init: () => [],
          apply(tr, old) {
            const meta = tr.getMeta(paginationKey)
            return Array.isArray(meta) ? (meta as SpacerSpec[]) : old
          },
        },
        props: {
          decorations(state) {
            const spacers = paginationKey.getState(state) || []
            if (!spacers.length) return DecorationSet.empty
            const decs = spacers.map((s, i) =>
              Decoration.widget(
                s.pos,
                () => {
                  const d = document.createElement('div')
                  d.className = 'page-gap-spacer'
                  d.style.height = `${Math.max(0, Math.round(s.height))}px`
                  d.setAttribute('contenteditable', 'false')
                  d.setAttribute('aria-hidden', 'true')
                  return d
                },
                { side: -1, key: `pgs-${i}-${s.pos}-${Math.round(s.height)}` },
              ),
            )
            return DecorationSet.create(state.doc, decs)
          },
        },
      }),
    ]
  },
})

export function getPaginationSpacers(editor: any): SpacerSpec[] {
  if (!editor || editor.isDestroyed) return []
  try {
    return paginationKey.getState(editor.state) || []
  } catch {
    return []
  }
}

/** Replace the spacer set; returns true when it actually changed. A
 * meta-only transaction: no document change, no history step, no save. */
export function setPaginationSpacers(editor: any, spacers: SpacerSpec[]): boolean {
  if (!editor || editor.isDestroyed) return false
  const cur = getPaginationSpacers(editor)
  const same =
    cur.length === spacers.length &&
    cur.every((s, i) => s.pos === spacers[i].pos && Math.abs(s.height - spacers[i].height) < 0.5)
  if (same) return false
  editor.view.dispatch(editor.state.tr.setMeta(paginationKey, spacers))
  return true
}
