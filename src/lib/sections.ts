// Document Outline & section management (Mission 2, M2-11 = owner spec §4).
//
// A "section" is a heading plus everything up to (but not including) the
// next heading of equal-or-higher level (i.e. level <= its own level).
// Subsections (deeper headings) belong to their parent section, so moving
// a section always carries its subsections with it.
//
// Safety rules, all proven by sections.test.ts:
// - NOTHING here ever deletes content to fake a feature. Collapse only
//   adds a ProseMirror node decoration (CSS `display:none` on the section's
//   body blocks); the document JSON is byte-identical while collapsed, and
//   expanding removes the decoration. Collapsed state is session-only:
//   it is not stored in the document or localStorage, so a reload shows
//   everything again — content can never be hidden-and-lost.
// - Level change, section move and section select are each ONE editor
//   transaction, hence ONE undo step. A move is delete + insert inside a
//   single transaction (the slice is taken before the delete, the insert
//   position is mapped through the delete), so undo restores the original
//   document exactly and no text is ever lost or duplicated.
// - Moving a section into itself (target heading inside the moved section)
//   or a no-op move (insert position identical to the section's own edge)
//   is rejected and leaves the document untouched.
// - "Move into" (child move) is deliberately narrow: the target heading's
//   section must contain no other heading, and the moved heading must be
//   deeper than the target. The section is then inserted at the end of the
//   target's section, so it becomes the target's child in outline order
//   while the target's own body text stays with the target. Anything wider
//   would silently re-parent other sections' body text, so it is rejected.
// - Heading text is never normalised: FA/Dari text (including ZWNJ-joined
//   words) and mixed FA+EN text pass through untouched; the pure functions
//   below only look at levels and positions, never at characters.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { LiveHeading } from './headings'

export interface SectionRange {
  /** Index of the section's heading in the headings list. */
  index: number
  /** Doc position of the heading node itself. */
  from: number
  /** Doc position just past the section's last block (exclusive end). */
  to: number
  /** Index of the last heading belonging to this section (itself or a subsection). */
  lastHeadingIndex: number
}

/** Section range for headings[index], or null when the index is invalid. */
export function sectionRange(
  headings: LiveHeading[],
  index: number,
  docEnd: number,
): SectionRange | null {
  if (index < 0 || index >= headings.length) return null
  const head = headings[index]
  let lastHeadingIndex = index
  let to = docEnd
  for (let j = index + 1; j < headings.length; j++) {
    if (headings[j].level <= head.level) {
      to = headings[j].from
      break
    }
    lastHeadingIndex = j
  }
  return { index, from: head.from, to, lastHeadingIndex }
}

export interface LevelSkipWarning {
  /** Index of the offending heading. */
  index: number
  level: number
  /** Level of the previous heading. */
  prevLevel: number
}

/**
 * Headings whose level jumps MORE than one deeper than the previous
 * heading (e.g. H1 -> H3). Going shallower (H3 -> H1) is never a warning,
 * and the first heading has no predecessor so it is never flagged. Warnings
 * are reported only — nothing is auto-fixed.
 */
export function levelSkipWarnings(headings: LiveHeading[]): LevelSkipWarning[] {
  const out: LevelSkipWarning[] = []
  for (let i = 1; i < headings.length; i++) {
    if (headings[i].level > headings[i - 1].level + 1) {
      out.push({ index: i, level: headings[i].level, prevLevel: headings[i - 1].level })
    }
  }
  return out
}

export type MoveWhere = 'before' | 'after' | 'child'

export interface SectionMovePlan {
  srcFrom: number
  srcTo: number
  /** Insertion position in the ORIGINAL document (mapped by the editor op). */
  insertPos: number
}

/**
 * Pure move plan: where would the section land, or why is the move invalid?
 * Returns null for: bad indices, target inside the moved section, a no-op,
 * a child move that is not deeper than the target, or a child move whose
 * target section contains other headings (see the header comment).
 */
export function planSectionMove(
  headings: LiveHeading[],
  docEnd: number,
  srcIndex: number,
  destIndex: number,
  where: MoveWhere,
): SectionMovePlan | null {
  const src = sectionRange(headings, srcIndex, docEnd)
  const dest = sectionRange(headings, destIndex, docEnd)
  if (!src || !dest) return null
  // Target inside the moved section (including a subsection of it) would
  // move the section into itself.
  if (destIndex > srcIndex && destIndex <= src.lastHeadingIndex) return null
  let insertPos: number
  if (where === 'before') {
    insertPos = headings[destIndex].from
  } else if (where === 'after') {
    insertPos = dest.to
  } else {
    // Child move: target section must be a single heading, and the moved
    // heading must be deeper than the target.
    if (dest.lastHeadingIndex !== destIndex) return null
    if (headings[srcIndex].level <= headings[destIndex].level) return null
    insertPos = dest.to
  }
  // No-op: the section already sits exactly at the insertion point.
  if (insertPos === src.from || insertPos === src.to) return null
  return { srcFrom: src.from, srcTo: src.to, insertPos }
}

// ---------------------------------------------------------------------------
// Editor operations (each is a single transaction = a single undo step).
// `editor` is typed loosely so the same helpers serve the React editor and
// the headless test editor; they only use state/view/dispatch.
// ---------------------------------------------------------------------------

/** Change a heading's level (1-6), or convert it to a paragraph (level null). */
export function setHeadingLevel(editor: any, heading: LiveHeading, level: number | null): boolean {
  if (!editor || !heading) return false
  if (level !== null && (level < 1 || level > 6)) return false
  const { state } = editor
  const node = state.doc.nodeAt(heading.from)
  if (!node || node.type.name !== 'heading') return false
  if (level !== null && node.attrs.level === level) return false
  const type = level === null ? state.schema.nodes.paragraph : state.schema.nodes.heading
  if (!type) return false
  const tr = state.tr.setNodeMarkup(
    heading.from,
    type,
    level === null ? undefined : { ...node.attrs, level },
  )
  editor.view.dispatch(tr)
  return true
}

/**
 * Select a whole section (heading + body + subsections), from the heading
 * node to just before the next equal-or-higher heading. Returns false when
 * the section cannot be selected (empty doc, bad index).
 *
 * Endpoints sit INSIDE textblocks (heading content start .. last block's
 * text end), never on node boundaries: a TextSelection anchored on a block
 * boundary is not a valid editor selection, and the view corrects it
 * unpredictably (observed: collapsing to the next heading). When the
 * section's last block is not a textblock (table, image), the boundary
 * selection is attempted as a fallback.
 */
export function selectSection(
  editor: any,
  headings: LiveHeading[],
  index: number,
  docEnd: number,
): boolean {
  const range = sectionRange(headings, index, docEnd)
  if (!range || !editor) return false
  const { state } = editor
  // Last top-level block of the section, for an inside-text endpoint.
  let lastTo = -1
  let lastIsTextblock = false
  state.doc.forEach((child: any, offset: number) => {
    const from = offset
    const to = offset + child.nodeSize
    if (from >= range.from && to <= range.to) {
      lastTo = to
      lastIsTextblock = !!child.isTextblock
    }
  })
  const from = headings[index].contentPos
  const insideTo = lastIsTextblock ? lastTo - 1 : -1
  try {
    const to = insideTo >= from ? insideTo : range.to
    const tr = state.tr.setSelection(TextSelection.create(state.doc, from, to))
    editor.view.dispatch(tr)
    return true
  } catch {
    return false
  }
}

/**
 * Move a whole section (heading + body + subsections) as one block.
 * Single transaction, single undo step. Returns false (document untouched)
 * when the plan is invalid.
 */
export function moveSection(
  editor: any,
  headings: LiveHeading[],
  docEnd: number,
  srcIndex: number,
  destIndex: number,
  where: MoveWhere,
): boolean {
  const plan = planSectionMove(headings, docEnd, srcIndex, destIndex, where)
  if (!plan || !editor) return false
  const { state } = editor
  try {
    const tr = state.tr
    const slice = tr.doc.slice(plan.srcFrom, plan.srcTo)
    tr.delete(plan.srcFrom, plan.srcTo)
    const ins = tr.mapping.map(plan.insertPos)
    tr.insert(ins, slice.content)
    // Leave the cursor at the start of the moved heading.
    try { tr.setSelection(TextSelection.create(tr.doc, ins + 1)) } catch { /* selection is best-effort */ }
    editor.view.dispatch(tr)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Section collapse: decoration-only hiding (see the header comment).
// ---------------------------------------------------------------------------

export const sectionCollapseKey = new PluginKey('sectionCollapse')

/**
 * Node decorations for a section's NON-heading body blocks. Subsection
 * headings are never hidden: collapsing a section hides its prose, tables
 * and images, while its subsection headings stay visible as outline
 * structure (the spec's "non-heading content" rule).
 */
function decorationsForBody(doc: any, bodyFrom: number, bodyTo: number): any[] {
  const decos: any[] = []
  doc.forEach((child: any, offset: number) => {
    if (child.type.name === 'heading') return
    const from = offset
    const to = offset + child.nodeSize
    if (from >= bodyFrom && to <= bodyTo) {
      decos.push(Decoration.node(from, to, { class: 'section-hidden' }))
    }
  })
  return decos
}

/** True when a section's body contains at least one non-heading block. */
export function hasNonHeadingBody(doc: any, headings: LiveHeading[], index: number, docEnd: number): boolean {
  const body = sectionBodyRange(headings, index, docEnd)
  if (!body) return false
  let found = false
  doc.forEach((child: any, offset: number) => {
    const from = offset
    const to = offset + child.nodeSize
    if (child.type.name !== 'heading' && from >= body.from && to <= body.to) found = true
  })
  return found
}

/**
 * TipTap extension holding the collapsed-section decorations. It owns no
 * document state: collapsing dispatches a meta-only transaction, so it
 * creates no undo step and never touches the document JSON.
 */
export const SectionCollapse = Extension.create({
  name: 'sectionCollapse',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: sectionCollapseKey,
        state: {
          init() {
            return DecorationSet.empty
          },
          apply(tr: any, old: any) {
            let set = old
            if (tr.docChanged) set = set.map(tr.mapping, tr.doc)
            const meta = tr.getMeta(sectionCollapseKey)
            if (meta?.collapse) {
              const { from, to } = meta.collapse
              const fresh = decorationsForBody(tr.doc, from, to)
                .filter((d: any) => set.find(d.from, d.to).length === 0)
              if (fresh.length) set = set.add(tr.doc, fresh)
            }
            if (meta?.expand) {
              const { from, to } = meta.expand
              const found = set.find(from, to)
              if (found.length) set = set.remove(found)
            }
            return set
          },
        },
        props: {
          decorations(state: any) {
            return sectionCollapseKey.getState(state)
          },
        },
      }),
    ]
  },
})

/** Body range of a section (everything after its heading node), or null when it has no body. */
export function sectionBodyRange(
  headings: LiveHeading[],
  index: number,
  docEnd: number,
): { from: number; to: number } | null {
  const range = sectionRange(headings, index, docEnd)
  if (!range) return null
  const from = headings[index].to
  if (from >= range.to) return null
  return { from, to: range.to }
}

/** True when any body block of the section is currently hidden. */
export function isSectionCollapsed(editor: any, headings: LiveHeading[], index: number, docEnd: number): boolean {
  const body = sectionBodyRange(headings, index, docEnd)
  if (!body || !editor) return false
  try {
    const set = sectionCollapseKey.getState(editor.state)
    return !!set && set.find(body.from, body.to).length > 0
  } catch {
    return false
  }
}

/** Hide a section's body blocks. Returns false when there is nothing hideable (no body, or body of headings only). */
export function collapseSection(editor: any, headings: LiveHeading[], index: number, docEnd: number): boolean {
  const body = sectionBodyRange(headings, index, docEnd)
  if (!body || !editor) return false
  editor.view.dispatch(editor.state.tr.setMeta(sectionCollapseKey, { collapse: body }))
  return isSectionCollapsed(editor, headings, index, docEnd)
}

/** Show a collapsed section's body blocks again, exactly as before. */
export function expandSection(editor: any, headings: LiveHeading[], index: number, docEnd: number): boolean {
  const body = sectionBodyRange(headings, index, docEnd)
  if (!body || !editor) return false
  editor.view.dispatch(editor.state.tr.setMeta(sectionCollapseKey, { expand: body }))
  return true
}

/** Toggle collapse; returns the new collapsed state, or null when there is no body. */
export function toggleSectionCollapsed(
  editor: any,
  headings: LiveHeading[],
  index: number,
  docEnd: number,
): boolean | null {
  const body = sectionBodyRange(headings, index, docEnd)
  if (!body) return null
  if (isSectionCollapsed(editor, headings, index, docEnd)) {
    expandSection(editor, headings, index, docEnd)
    return false
  }
  collapseSection(editor, headings, index, docEnd)
  return true
}
