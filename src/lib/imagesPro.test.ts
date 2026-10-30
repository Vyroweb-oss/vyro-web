import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { validateImageFile, imageSizeKb, MAX_IMAGE_BYTES, IMAGE_WIDTH_PRESETS } from './images'

const editors: Editor[] = []
function makeEditor(content: any) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const ed = new Editor({ element, extensions: [StarterKit, Image], content })
  editors.push(ed)
  return ed
}
afterEach(() => { while (editors.length) editors.pop()!.destroy() })

const imgNode = (attrs: any) => ({ type: 'image', attrs })
const docWith = (node: any) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'before' }] }, node, { type: 'paragraph', content: [{ type: 'text', text: 'after' }] }] })

describe('image file validation (2 MB cap)', () => {
  it('accepts an image at exactly the cap', () => {
    expect(validateImageFile({ type: 'image/png', size: MAX_IMAGE_BYTES })).toBeNull()
  })
  it('rejects an image one byte over the cap', () => {
    expect(validateImageFile({ type: 'image/png', size: MAX_IMAGE_BYTES + 1 })).toBe('imageTooLarge')
  })
  it('rejects non-image files and missing files', () => {
    expect(validateImageFile({ type: 'application/pdf', size: 100 })).toBe('imageInvalid')
    expect(validateImageFile(null)).toBe('imageInvalid')
  })
  it('reports whole kilobytes, never 0', () => {
    expect(imageSizeKb(1500)).toBe(1)
    expect(imageSizeKb(2048)).toBe(2)
    expect(IMAGE_WIDTH_PRESETS.map((p) => p.value)).toEqual(['', '25%', '50%', '75%', '100%'])
  })
})

describe('image width + caption via native attrs', () => {
  it('width preset and caption (title) persist through save/load JSON round-trip', () => {
    const ed = makeEditor(docWith(imgNode({ src: 'data:image/png;base64,AAA', alt: 'A', title: 'My caption', width: '50%' })))
    const json = ed.getJSON() as any
    const node = json.content[1]
    expect(node.attrs.width).toBe('50%')
    expect(node.attrs.title).toBe('My caption')
    const reopened = makeEditor(json)
    const back = (reopened.getJSON() as any).content[1]
    expect(back.attrs.width).toBe('50%')
    expect(back.attrs.title).toBe('My caption')
  })
  it('renders width attr with no height attr, so CSS height:auto preserves aspect ratio', () => {
    const ed = makeEditor(docWith(imgNode({ src: 'data:image/png;base64,AAA', width: '75%' })))
    const html = ed.getHTML()
    expect(html).toContain('width="75%"')
    expect(html).not.toMatch(/<img[^>]*height=/)
  })
  it('replace swaps src while keeping alt, width and caption', () => {
    const ed = makeEditor(docWith(imgNode({ src: 'old.png', alt: 'Keep me', title: 'Cap', width: '25%' })))
    // Select the image node, then update only its src (the dialog's Replace path).
    let imgPos = -1
    ed.state.doc.descendants((n: any, pos: number) => { if (n.type.name === 'image' && imgPos < 0) imgPos = pos })
    expect(imgPos).toBeGreaterThanOrEqual(0)
    ed.commands.setNodeSelection(imgPos)
    expect(ed.commands.updateAttributes('image', { src: 'new.png' })).toBe(true)
    const node = (ed.getJSON() as any).content[1]
    expect(node.attrs.src).toBe('new.png')
    expect(node.attrs.alt).toBe('Keep me')
    expect(node.attrs.width).toBe('25%')
    expect(node.attrs.title).toBe('Cap')
  })
  it('delete removes the image node', () => {
    const ed = makeEditor(docWith(imgNode({ src: 'x.png' })))
    let imgPos = -1
    ed.state.doc.descendants((n: any, pos: number) => { if (n.type.name === 'image' && imgPos < 0) imgPos = pos })
    ed.commands.setNodeSelection(imgPos)
    expect(ed.commands.deleteSelection()).toBe(true)
    expect(JSON.stringify(ed.getJSON())).not.toContain('x.png')
  })
})
