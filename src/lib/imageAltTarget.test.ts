// Context-menu image alt-text save defect (found live in P2-19,
// 2026-11-02): the "Edit image description" dialog opened from the
// right-click context menu did NOT persist the alt text, while the
// toolbar "Edit image" dialog on the same image DID.
//
// Root cause, proven by the engine-level tests below: the old save path
// (applyImageAlt in Editor.tsx) ran a bare
//   chain().focus().updateAttributes('image', { alt })
// which acts on whatever node the editor's AMBIENT selection points at
// when Save is pressed. With a NodeSelection on the image it sets the
// alt; with an ordinary text cursor it silently no-ops (returns false,
// alt stays null). The context-menu path never carried a reference to
// the clicked image into the dialog, so by Save time nothing guaranteed
// the image was still the selected node.
//
// The fix: capture a stable target (doc position + src) when the menu
// opens, keep it in a ref while the dialog is open, and on Save
// re-select exactly that node and verify it is still the same image
// before writing. These tests pin that contract; the behavioural tests
// run against the real TipTap engine, and source guards pin the
// Editor.tsx wiring so the ambient path cannot quietly come back for
// this dialog.
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import {
  captureImageTarget, resolveMenuImageTarget, imageTargetAlt,
  isImageTargetCurrent, applyAltToTarget,
} from './imageAltTarget'

const SRC_A = 'data:image/png;base64,AAAA'
const SRC_B = 'data:image/png;base64,BBBB'

let editor: Editor | null = null
afterEach(() => { editor?.destroy(); editor = null })

function makeEditor(secondImage = false) {
  editor = new Editor({
    extensions: [StarterKit, Image],
    // NOTE: in this TipTap stack Image is a BLOCK node (inline:false),
    // so in real Vyro documents an image is a top-level node between
    // paragraphs — the fixture mirrors that exactly (an image nested
    // inside a paragraph is invalid content and corrupts positions).
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before text' }] },
        { type: 'image', attrs: { src: SRC_A, alt: null } },
        ...(secondImage ? [{ type: 'image', attrs: { src: SRC_B, alt: null } }] : []),
        { type: 'paragraph', content: [{ type: 'text', text: 'After text' }] },
      ],
    },
  })
  return editor
}

/** Doc position of the first (or n-th) image node. */
function imagePos(ed: Editor, which = 0): number {
  let found = -1; let seen = 0
  ed.state.doc.descendants((node, pos) => {
    if (node.type.name === 'image') { if (seen === which) found = pos; seen++ }
    return true
  })
  if (found < 0) throw new Error('image not found')
  return found
}

function altOf(ed: Editor, which = 0): string | null {
  const node = ed.state.doc.nodeAt(imagePos(ed, which))
  return (node?.attrs.alt as string) ?? null
}

/** Simulate the dialog being open while the editor selection ends up
 *  as an ordinary text cursor far away from the image (the live
 *  failure condition). */
function moveSelectionToText(ed: Editor) {
  // "After text" paragraph: select inside its text.
  const afterPos = ed.state.doc.content.size - 3
  ed.commands.setTextSelection(afterPos)
  expect((ed.state.selection as any).node).toBeFalsy()
}

describe('root cause (engine behaviour the old dialog relied on)', () => {
  it('ambient updateAttributes with a text cursor silently does NOT set alt', () => {
    const ed = makeEditor()
    moveSelectionToText(ed)
    const ok = ed.chain().focus().updateAttributes('image', { alt: 'lost' }).run()
    expect(ok).toBe(false)
    expect(altOf(ed)).toBeNull()
  })

  it('ambient updateAttributes DOES set alt while the image is node-selected (the toolbar path)', () => {
    const ed = makeEditor()
    ed.commands.setNodeSelection(imagePos(ed))
    const ok = ed.chain().focus().updateAttributes('image', { alt: 'kept' }).run()
    expect(ok).toBe(true)
    expect(altOf(ed)).toBe('kept')
  })
})

describe('capture / resolve', () => {
  it('captures position + src for an image position, null elsewhere', () => {
    const ed = makeEditor()
    const pos = imagePos(ed)
    expect(captureImageTarget(ed.state.doc, pos)).toEqual({ pos, src: SRC_A })
    expect(captureImageTarget(ed.state.doc, 1)).toBeNull() // inside "Before text"
    expect(captureImageTarget(ed.state.doc, -1)).toBeNull()
    expect(captureImageTarget(ed.state.doc, ed.state.doc.content.size + 50)).toBeNull()
  })

  it('resolves the menu target from the hit position', () => {
    const ed = makeEditor()
    const pos = imagePos(ed)
    const target = resolveMenuImageTarget(ed.state.doc, pos, { from: 0, nodeName: null })
    expect(target).toEqual({ pos, src: SRC_A })
  })

  it('resolves the menu target from a NodeSelection when the hit misses', () => {
    const ed = makeEditor()
    const pos = imagePos(ed)
    const target = resolveMenuImageTarget(ed.state.doc, null, { from: pos, nodeName: 'image' })
    expect(target).toEqual({ pos, src: SRC_A })
    expect(resolveMenuImageTarget(ed.state.doc, null, { from: pos, nodeName: null })).toBeNull()
    expect(resolveMenuImageTarget(ed.state.doc, null, null)).toBeNull()
  })

  it('reads back the current alt of the target for the dialog prefill', () => {
    const ed = makeEditor()
    const pos = imagePos(ed)
    ed.commands.setNodeSelection(pos)
    ed.chain().updateAttributes('image', { alt: 'existing' }).run()
    const target = captureImageTarget(ed.state.doc, pos)!
    expect(imageTargetAlt(ed.state.doc, target)).toBe('existing')
  })
})

describe('applyAltToTarget (the fixed context-menu save)', () => {
  it('saves alt to the captured image even after the selection moved to text', () => {
    const ed = makeEditor()
    const target = captureImageTarget(ed.state.doc, imagePos(ed))!
    moveSelectionToText(ed) // dialog open; ambient selection no longer the image
    expect(applyAltToTarget(ed, target, 'A described image')).toBe(true)
    expect(altOf(ed)).toBe('A described image')
  })

  it('reopening read-back: the saved alt is what a reopened dialog would show', () => {
    const ed = makeEditor()
    const target = captureImageTarget(ed.state.doc, imagePos(ed))!
    moveSelectionToText(ed)
    expect(applyAltToTarget(ed, target, 'persisted')).toBe(true)
    const reopened = captureImageTarget(ed.state.doc, imagePos(ed))!
    expect(imageTargetAlt(ed.state.doc, reopened)).toBe('persisted')
  })

  it('preserves Persian text, English text and long text exactly', () => {
    const ed = makeEditor()
    const target = captureImageTarget(ed.state.doc, imagePos(ed))!
    const fa = 'توضیح فارسی تصویر — عروسی در باغ با خانواده'
    expect(applyAltToTarget(ed, target, fa)).toBe(true)
    expect(altOf(ed)).toBe(fa)
    const long = 'Long alt text '.repeat(13).trim() // 181 chars
    expect(long.length).toBe(181)
    expect(applyAltToTarget(ed, target, long)).toBe(true)
    expect(altOf(ed)).toBe(long)
  })

  it('changes ONLY the target image when the document has two images', () => {
    const ed = makeEditor(true)
    const targetB = captureImageTarget(ed.state.doc, imagePos(ed, 1))!
    moveSelectionToText(ed)
    expect(applyAltToTarget(ed, targetB, 'second image')).toBe(true)
    expect(altOf(ed, 0)).toBeNull()
    expect(altOf(ed, 1)).toBe('second image')
  })

  it('empty alt clears to null (same semantics as the old dialog)', () => {
    const ed = makeEditor()
    const pos = imagePos(ed)
    ed.commands.setNodeSelection(pos)
    ed.chain().updateAttributes('image', { alt: 'to clear' }).run()
    const target = captureImageTarget(ed.state.doc, pos)!
    moveSelectionToText(ed)
    expect(applyAltToTarget(ed, target, null)).toBe(true)
    expect(altOf(ed)).toBeNull()
  })

  it('target deleted before Save: refuses and changes nothing', () => {
    const ed = makeEditor()
    const target = captureImageTarget(ed.state.doc, imagePos(ed))!
    // Delete the image node (what a delete before Save would do).
    const pos = imagePos(ed)
    ed.chain().setNodeSelection(pos).deleteSelection().run()
    const before = JSON.stringify(ed.getJSON())
    expect(isImageTargetCurrent(ed.state.doc, target)).toBe(false)
    expect(applyAltToTarget(ed, target, 'must not land anywhere')).toBe(false)
    expect(JSON.stringify(ed.getJSON())).toBe(before)
  })

  it('a DIFFERENT image now at the captured position: refuses, its alt untouched', () => {
    const ed = makeEditor(true)
    const targetA = captureImageTarget(ed.state.doc, imagePos(ed, 0))!
    // Remove image A so image B shifts into A's old position.
    ed.chain().setNodeSelection(imagePos(ed, 0)).deleteSelection().run()
    expect(ed.state.doc.nodeAt(targetA.pos)?.attrs.src).toBe(SRC_B)
    expect(applyAltToTarget(ed, targetA, 'wrong image')).toBe(false)
    expect(altOf(ed, 0)).toBeNull() // B (now first) untouched
  })
})

describe('Editor.tsx wiring (source guards)', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/components/Editor.tsx'), 'utf8')

  it('the context menu state carries a captured image target', () => {
    expect(src).toContain('imageTarget')
    expect(src).toContain('resolveMenuImageTarget(')
  })

  it('the imageAlt menu action stores the target and prefills from it', () => {
    expect(src).toContain('altTargetRef.current=imageTarget')
    expect(src).toContain('imageTargetAlt(editor.state.doc, imageTarget)')
  })

  it('applyImageAlt saves through the target, not the ambient selection', () => {
    const start = src.indexOf('const applyImageAlt=')
    expect(start).toBeGreaterThan(-1)
    const body = src.slice(start, start + 700)
    expect(body).toContain('applyAltToTarget(editor, target, alt)')
  })

  it('closing the alt dialog clears the captured target (cancel can never save later)', () => {
    expect(src).toContain('const closeAltDialog=')
    expect(src).toContain('altTargetRef.current=null')
  })

  it('the toolbar Edit-image path is unchanged (ambient, selection-gated)', () => {
    expect(src).toContain("const openImageEdit=()=>{ dialogOpenerRef.current=document.activeElement; const a=editor.getAttributes('image')")
    expect(src).toContain("editor.chain().focus().updateAttributes('image', { src: imgSrc, alt: imgAlt.trim()||null, title: imgCaption.trim()||null, width: imgWidth||null } as any).run()")
  })
})
