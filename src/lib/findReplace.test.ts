import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import {
  findMatches, findDocMatches, previewSnippet, blockOfMatch,
  replaceMatch, replaceAllMatches, jumpToPosition, selectMatch,
} from './findReplace'

// ZWNJ written as an explicit escape so the test file never depends on an
// invisible character surviving an edit round-trip.
const ZWNJ = '\u200C'

describe('findMatches: FA/Dari/EN correctness', () => {
  it('finds Persian words (multiple occurrences, exact positions)', () => {
    expect(findMatches('سلام دنیا سلام', 'سلام')).toEqual([
      { start: 0, end: 4 },
      { start: 10, end: 14 },
    ])
  })
  it('does NOT normalise away ZWNJ: joined vs spaced words are different', () => {
    const text = `می${ZWNJ}خواهم می خواهم`
    expect(findMatches(text, `می${ZWNJ}خواهم`)).toHaveLength(1)
    expect(findMatches(text, 'می خواهم')).toHaveLength(1)
  })
  it('ZWNJ counts as a word character for whole-word matching', () => {
    // "می" inside the joined word می‌خواهم is NOT a whole word…
    expect(findMatches(`می${ZWNJ}خواهم`, 'می', { wholeWord: true })).toEqual([])
    // …but it is a whole word when separated by a real space.
    expect(findMatches('می خواهم', 'می', { wholeWord: true })).toEqual([{ start: 0, end: 2 }])
    // …and a joined word followed by more letters is not a whole word either.
    expect(findMatches(`می${ZWNJ}خواهند`, `می${ZWNJ}خواهم`, { wholeWord: true })).toEqual([])
  })
  it('matches Persian and Arabic-Indic digits exactly, without converting them', () => {
    expect(findMatches('۱۲۳ و ٤٥٦ و 123', '۱۲۳')).toEqual([{ start: 0, end: 3 }])
    expect(findMatches('۱۲۳ و ٤٥٦ و 123', '٤٥')).toEqual([{ start: 6, end: 8 }])
    // Latin digits must not match Persian digits (no digit conversion).
    expect(findMatches('۱۲۳', '123')).toEqual([])
  })
  it('handles mixed FA+EN text', () => {
    expect(findMatches('Hello سلام World سلام', 'سلام')).toHaveLength(2)
    expect(findMatches('Hello سلام World', 'hello')).toEqual([{ start: 0, end: 5 }])
  })
  it('case-sensitive vs insensitive only affects Latin letters', () => {
    expect(findMatches('Hello hello HELLO', 'hello')).toHaveLength(3)
    expect(findMatches('Hello hello HELLO', 'hello', { caseSensitive: true })).toEqual([
      { start: 6, end: 11 },
    ])
    // Persian text is unaffected by the case toggle.
    expect(findMatches('سلام سلام', 'سلام', { caseSensitive: true })).toHaveLength(2)
  })
  it('whole-word on vs off', () => {
    expect(findMatches('cat cats cat', 'cat', { wholeWord: true })).toEqual([
      { start: 0, end: 3 },
      { start: 9, end: 12 },
    ])
    expect(findMatches('cat cats cat', 'cat')).toHaveLength(3)
  })
  it('empty query finds nothing', () => {
    expect(findMatches('anything', '')).toEqual([])
    expect(findMatches('', 'x')).toEqual([])
  })
  it('overlapping matches are not double-counted', () => {
    expect(findMatches('aaa', 'aa')).toEqual([{ start: 0, end: 2 }])
  })
  it('regex metacharacters in the query are matched literally', () => {
    expect(findMatches('a.c axc', 'a.c')).toEqual([{ start: 0, end: 3 }])
  })
  it('previewSnippet applies the replacement with context, before confirming', () => {
    const text = 'این یک سند آزمایشی برای جایگزینی است'
    const [m] = findMatches(text, 'آزمایشی')
    const preview = previewSnippet(text, m, 'نهایی')
    expect(preview).toContain('نهایی')
    expect(preview).not.toContain('آزمایشی')
    expect(preview.startsWith('…') || preview.startsWith('این')).toBe(true)
  })
})

// ---- Headless editor: real extension stack (StarterKit) ----

const editors: Editor[] = []
function makeEditor(content: any, extra: any[] = []) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const ed = new Editor({ element, extensions: [StarterKit, ...extra], content })
  editors.push(ed)
  return ed
}
afterEach(() => { while (editors.length) editors.pop()!.destroy() })

describe('findDocMatches on a real doc', () => {
  it('covers headings AND body text', () => {
    const ed = makeEditor({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'گزارش سلام' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'متن سلام دوباره' }] },
      ],
    })
    const matches = findDocMatches(ed.state.doc, 'سلام')
    expect(matches).toHaveLength(2)
    for (const m of matches) expect(ed.state.doc.textBetween(m.from, m.to)).toBe('سلام')
  })
  it('positions stay exact after an inline atom (image) in the same block', () => {
    const ed = makeEditor(
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'قبل ' },
              { type: 'image', attrs: { src: 'x.png' } },
              { type: 'text', text: 'بعد هدف' },
            ],
          },
        ],
      },
      [Image],
    )
    const matches = findDocMatches(ed.state.doc, 'هدف')
    expect(matches).toHaveLength(1)
    expect(ed.state.doc.textBetween(matches[0].from, matches[0].to)).toBe('هدف')
  })
  it('blockOfMatch gives the preview context for a doc match', () => {
    const ed = makeEditor({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello world hello' }] }],
    })
    const [m] = findDocMatches(ed.state.doc, 'world')
    const ctx = blockOfMatch(ed.state.doc, m)
    expect(ctx?.blockText).toBe('hello world hello')
    expect(previewSnippet(ctx!.blockText, ctx!.inBlock, 'دوست')).toContain('دوست')
  })
})

describe('live-editor replace + jump (real extension stack)', () => {
  it('replace-one preserves the replaced text marks (bold stays bold)', () => {
    const ed = makeEditor({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hello ' },
            { type: 'text', text: 'world', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    })
    const [m] = findDocMatches(ed.state.doc, 'world')
    replaceMatch(ed, m, 'دوست')
    expect(ed.getText()).toBe('Hello دوست')
    const json = ed.getJSON() as any
    const replaced = json.content[0].content.find((n: any) => n.text === 'دوست')
    expect(replaced.marks?.some((mk: any) => mk.type === 'bold')).toBe(true)
  })
  it('replace-all is a SINGLE undo step: one Undo restores the whole document', () => {
    const ed = makeEditor({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a b a' }] }],
    })
    const matches = findDocMatches(ed.state.doc, 'a')
    expect(matches).toHaveLength(2)
    replaceAllMatches(ed, matches, 'x')
    expect(ed.getText()).toBe('x b x')
    expect(ed.commands.undo()).toBe(true)
    expect(ed.getText()).toBe('a b a')
  })
  it('replace-all with an empty replacement deletes all matches in one undo step', () => {
    const ed = makeEditor({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a b a' }] }],
    })
    replaceAllMatches(ed, findDocMatches(ed.state.doc, 'a'), '')
    expect(ed.getText()).toBe(' b ')
    ed.commands.undo()
    expect(ed.getText()).toBe('a b a')
  })
  it('selection-scope replace-all touches only matches inside the selection', () => {
    const ed = makeEditor({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'foo bar foo' }] }],
    })
    // Select "foo bar" (doc positions 1..8); the second "foo" is outside.
    ed.commands.setTextSelection({ from: 1, to: 8 })
    const sel = ed.state.selection
    const inScope = findDocMatches(ed.state.doc, 'foo').filter(
      (m) => m.from >= sel.from && m.to <= sel.to,
    )
    expect(inScope).toHaveLength(1)
    replaceAllMatches(ed, inScope, 'baz')
    expect(ed.getText()).toBe('baz bar foo')
  })
  it('jumpToPosition moves the cursor to a heading start; selectMatch selects a match', () => {
    const ed = makeEditor({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'body target here' }] },
      ],
    })
    jumpToPosition(ed, 1)
    expect(ed.state.selection.from).toBe(1)
    const [m] = findDocMatches(ed.state.doc, 'target')
    selectMatch(ed, m)
    expect(ed.state.doc.textBetween(ed.state.selection.from, ed.state.selection.to)).toBe('target')
  })
})
