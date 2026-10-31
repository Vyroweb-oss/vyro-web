import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { extractHeadings, extractLiveHeadings, activeHeadingIndex } from './headings'

describe('extractHeadings from stored JSON', () => {
  it('returns levels, text, and document order', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'One' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'body' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Two' }] },
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Three' }] },
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Back' }] },
      ],
    }
    expect(extractHeadings(doc)).toEqual([
      { level: 1, text: 'One', empty: false },
      { level: 2, text: 'Two', empty: false },
      { level: 3, text: 'Three', empty: false },
      { level: 1, text: 'Back', empty: false },
    ])
  })
  it('flags empty headings (no text, or whitespace only)', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 } },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '   ' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Real' }] },
      ],
    }
    const out = extractHeadings(doc)
    expect(out.map((h) => h.empty)).toEqual([true, true, false])
  })
  it('concatenates text across marks and returns [] for a doc without headings', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [
            { type: 'text', text: 'سلام ' },
            { type: 'text', text: 'دنیا', marks: [{ type: 'bold' }] },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'no headings here' }] },
      ],
    }
    expect(extractHeadings(doc)).toEqual([{ level: 1, text: 'سلام دنیا', empty: false }])
    expect(extractHeadings({ type: 'doc', content: [{ type: 'paragraph' }] })).toEqual([])
  })
})

const editors: Editor[] = []
function makeEditor(content: any) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const ed = new Editor({ element, extensions: [StarterKit], content })
  editors.push(ed)
  return ed
}
afterEach(() => { while (editors.length) editors.pop()!.destroy() })

describe('extractLiveHeadings + active heading (real doc)', () => {
  it('live headings carry jump positions that select the heading text', () => {
    const ed = makeEditor({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'body' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Sub' }] },
      ],
    })
    const headings = extractLiveHeadings(ed.state.doc)
    expect(headings.map((h) => ({ level: h.level, text: h.text, empty: h.empty }))).toEqual([
      { level: 1, text: 'Title', empty: false },
      { level: 2, text: 'Sub', empty: false },
    ])
    // Jump target = first content character of the heading.
    expect(ed.state.doc.textBetween(headings[1].contentPos, headings[1].contentPos + 1)).toBe('S')
    // Empty heading in the live doc is flagged too.
    const ed2 = makeEditor({
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 1 } }],
    })
    expect(extractLiveHeadings(ed2.state.doc)[0].empty).toBe(true)
  })
  it('activeHeadingIndex: containing heading, nearest above, or -1 before the first', () => {
    const ed = makeEditor({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'intro' }] },
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'body' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Sub' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'tail' }] },
      ],
    })
    const headings = extractLiveHeadings(ed.state.doc)
    expect(activeHeadingIndex(headings, 1)).toBe(-1) // inside "intro", before any heading
    expect(activeHeadingIndex(headings, headings[0].contentPos)).toBe(0) // inside Title
    // Inside "body" (between Title and Sub): nearest above is Title.
    expect(activeHeadingIndex(headings, headings[0].to + 1)).toBe(0)
    expect(activeHeadingIndex(headings, headings[1].contentPos)).toBe(1) // inside Sub
    expect(activeHeadingIndex(headings, headings[1].to + 1)).toBe(1) // inside "tail"
  })
})

describe('P2-1b regression: ribbon heading style + Enter must not destroy the heading text', () => {
  it('the gallery chain (toggleHeading + collapse selection to its end) makes splitBlock safe', async () => {
    const { Editor } = await import('@tiptap/core')
    const StarterKit = (await import('@tiptap/starter-kit')).default
    const ed = new Editor({ extensions: [StarterKit], content: '<p>First Heading</p>' })
    try {
      ed.commands.setTextSelection({ from: 1, to: 14 })
      const to = ed.state.selection.to
      ;(ed.chain() as any).toggleHeading({ level: 1 }).setTextSelection(to).run()
      ed.commands.splitBlock()
      ed.commands.insertContent('Body')
      const texts: string[] = []
      ed.state.doc.forEach((n: any) => texts.push(`${n.type.name}(${(n.textContent || '')})`))
      expect(texts[0]).toBe('heading(First Heading)')
      expect(texts.join(' ')).toContain('paragraph(Body)')
    } finally { ed.destroy() }
  })
})
