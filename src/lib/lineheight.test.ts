import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TextStyleKit } from '@tiptap/extension-text-style'
import { createDoc, saveDocs, loadDocs } from './store'

// Line spacing (R5) uses the LineHeight extension that ships inside
// TextStyleKit — the same kit the Editor already enables for font family/size.
// These tests prove the whole contract with the real extension stack:
// command exists → stores an additive textStyle attr → renders an inline
// line-height style (which print honours) → survives a save/reopen round-trip.
const editors: Editor[] = []
function makeEditor(content: any) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const ed = new Editor({ element, extensions: [StarterKit, TextStyleKit], content })
  editors.push(ed)
  return ed
}
afterEach(() => { while (editors.length) editors.pop()!.destroy() })

describe('line spacing via TextStyleKit LineHeight', () => {
  it('setLineHeight stores the value as a textStyle attr in the doc JSON', () => {
    const ed = makeEditor({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello spacing' }] }] })
    ed.commands.selectAll()
    expect(ed.commands.setLineHeight('1.5')).toBe(true)
    const json = ed.getJSON() as any
    const text = json.content[0].content[0]
    const ts = (text.marks || []).find((m: any) => m.type === 'textStyle')
    expect(ts).toBeTruthy()
    expect(ts.attrs.lineHeight).toBe('1.5')
  })
  it('renders an inline line-height style (honoured on screen and in print)', () => {
    const ed = makeEditor({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Styled' }] }] })
    ed.commands.selectAll()
    ed.commands.setLineHeight('2')
    expect(ed.getHTML()).toContain('line-height: 2')
  })
  it('survives a reopen round-trip: a fresh editor reads the attr back at the cursor', () => {
    const ed = makeEditor({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Round trip' }] }] })
    ed.commands.selectAll()
    ed.commands.setLineHeight('1.15')
    const saved = ed.getJSON()
    const reopened = makeEditor(saved)
    reopened.commands.selectAll()
    expect(reopened.getAttributes('textStyle').lineHeight).toBe('1.15')
  })
  it('unsetLineHeight removes the attr again (back to default spacing)', () => {
    const ed = makeEditor({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Reset me' }] }] })
    ed.commands.selectAll()
    ed.commands.setLineHeight('1.5')
    ed.commands.selectAll()
    expect(ed.commands.unsetLineHeight()).toBe(true)
    const json = ed.getJSON() as any
    const text = json.content[0].content[0]
    const ts = (text.marks || []).find((m: any) => m.type === 'textStyle')
    expect(ts?.attrs?.lineHeight ?? null).toBeNull()
    expect(ed.getHTML()).not.toContain('line-height')
  })
  it('persists through the app store save/load path unchanged', () => {
    const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Persisted', marks: [{ type: 'textStyle', attrs: { lineHeight: '1.5' } }] }] }] }
    const m = new Map<string, string>()
    const fake = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } }
    const { docs } = createDoc([], { title: 'LH', content: JSON.parse(JSON.stringify(content)) })
    saveDocs(fake as any, docs)
    const back = loadDocs(fake as any)
    expect(back[0].content).toEqual(content)
  })
})
