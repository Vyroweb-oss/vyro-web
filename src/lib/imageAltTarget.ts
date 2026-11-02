// Stable target for the context-menu image alt-text dialog.
//
// Defect (found live in P2-19, 2026-11-02): "Edit image description"
// from the right-click context menu never persisted the alt text,
// while the toolbar "Edit image" dialog on the same image did. Root
// cause: the dialog's Save ran a bare
//   chain().focus().updateAttributes('image', { alt })
// which writes to whatever node the editor's AMBIENT selection points
// at when Save is pressed. updateAttributes on a non-selected node
// type silently no-ops (the chain returns false and the alt stays
// null), and nothing in the context-menu flow carried a reference to
// the clicked image into the dialog — so whenever the image was not
// still the selected node at Save time, the text was lost with no
// error. The toolbar path works because its button is gated on the
// image being the active (selected) node and preserves that selection
// through the click.
//
// Fix contract (pinned by imageAltTarget.test.ts):
// - When the context menu opens, capture a stable target: the doc
//   position of the image node plus its src.
// - The dialog prefills from THAT node, not from ambient attributes.
// - On Save, re-select exactly that position and verify the node
//   there is still an image with the captured src BEFORE writing;
//   if the target was deleted or replaced, write NOTHING (never land
//   the text on a different image) and report failure.
// - After writing, read back the node's alt; only an exact match
//   counts as applied.
// Text is never inspected or normalised here beyond the caller's own
// trim: FA/EN/Unicode and long strings pass through byte-identical.
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'

export interface ImageTarget {
  /** Doc position of the image node (the position nodeAt expects). */
  pos: number
  /** The image's src at capture time; identity check on Save. */
  src: string | null
}

function imageNodeAt(doc: PMNode, pos: number): PMNode | null {
  if (!Number.isInteger(pos) || pos < 0 || pos > doc.content.size) return null
  const node = doc.nodeAt(pos)
  return node && node.type.name === 'image' ? node : null
}

/** Capture the target for the image node at `pos`, or null. */
export function captureImageTarget(doc: PMNode, pos: number): ImageTarget | null {
  const node = imageNodeAt(doc, pos)
  if (!node) return null
  return { pos, src: (node.attrs.src as string) ?? null }
}

/**
 * Resolve which image a context menu was opened for. The hit position
 * (from posAtCoords) wins; a NodeSelection on an image is the fallback
 * (the menu code selects the hit image before opening, and a user may
 * also right-click an already-selected image whose hit maps beside
 * the node). Returns null when neither points at an image.
 */
export function resolveMenuImageTarget(
  doc: PMNode,
  hitPos: number | null,
  selection: { from: number; nodeName: string | null } | null,
): ImageTarget | null {
  if (hitPos != null) {
    const byHit = captureImageTarget(doc, hitPos)
    if (byHit) return byHit
  }
  if (selection && selection.nodeName === 'image') {
    return captureImageTarget(doc, selection.from)
  }
  return null
}

/** Current alt text of the target node ('' when unset or gone). */
export function imageTargetAlt(doc: PMNode, target: ImageTarget): string {
  const node = imageNodeAt(doc, target.pos)
  return node ? ((node.attrs.alt as string) || '') : ''
}

/** True only while the captured position still holds the SAME image. */
export function isImageTargetCurrent(doc: PMNode, target: ImageTarget): boolean {
  const node = imageNodeAt(doc, target.pos)
  return !!node && ((node.attrs.src as string) ?? null) === target.src
}

/**
 * Write `alt` (already trimmed by the caller; null clears) onto the
 * captured image — and nothing else. Re-selects the node first, so
 * the ambient selection at Save time is irrelevant. Returns false
 * without touching the document when the target is gone, replaced,
 * or the write cannot be read back exactly.
 */
export function applyAltToTarget(editor: Editor, target: ImageTarget, alt: string | null): boolean {
  if (!isImageTargetCurrent(editor.state.doc, target)) return false
  const ok = editor.chain().focus().setNodeSelection(target.pos).updateAttributes('image', { alt }).run()
  if (!ok) return false
  const node = imageNodeAt(editor.state.doc, target.pos)
  return !!node && ((node.attrs.alt as string) ?? null) === alt
}
