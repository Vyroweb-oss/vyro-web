// P2-12: go-to-heading Command Palette commands.
//
// The palette lists the current document's headings (via the existing
// headings.ts extraction — no duplicate parser) and jumping only moves
// the cursor + scrolls, never mutating content. No-headings case: no
// per-heading commands are registered at all (documented choice, not a
// disabled placeholder and never an invented heading).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { buildCommands, buildHeadingCommands, filterCommands } from './commands'
import { extractLiveHeadings } from './headings'
import { jumpToPosition } from './findReplace'
import { tr } from './i18n'
import { TEMPLATES } from './templates'

const editors: Editor[] = []
function makeEditor(content: any) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const ed = new Editor({ element, extensions: [StarterKit], content })
  editors.push(ed)
  return ed
}
afterEach(() => { while (editors.length) editors.pop()!.destroy() })

const base = {
  createBlank: vi.fn(), createFromTemplate: vi.fn(), goDashboard: vi.fn(),
  toggleTheme: vi.fn(), toggleLanguage: vi.fn(), theme: 'light', lang: 'en' as const,
  templates: TEMPLATES,
}

describe('buildHeadingCommands via the live heading source', () => {
  it('lists levels + text in document order, titles searchable by heading text', () => {
    const ed = makeEditor({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Introduction' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'body' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'روش کار' }] },
        { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Details' }] },
      ],
    })
    const headings = extractLiveHeadings(ed.state.doc)
    expect(headings.map((h) => ({ level: h.level, text: h.text }))).toEqual([
      { level: 1, text: 'Introduction' },
      { level: 2, text: 'روش کار' },
      { level: 3, text: 'Details' },
    ])
    const jump = vi.fn()
    const cmds = buildHeadingCommands(headings, jump)
    expect(cmds.map((c) => c.id)).toEqual(['go-to-heading:0', 'go-to-heading:1', 'go-to-heading:2'])
    expect(cmds.map((c) => c.title('en'))).toEqual([
      'Go to heading H1 · Introduction',
      'Go to heading H2 · روش کار',
      'Go to heading H3 · Details',
    ])
    // Searching by heading text (EN or FA) narrows to that heading.
    expect(filterCommands(cmds, 'روش', 'fa').map((c) => c.id)).toEqual(['go-to-heading:1'])
    expect(filterCommands(cmds, 'details', 'en').map((c) => c.id)).toEqual(['go-to-heading:2'])
    // Searching the command prefix finds every heading entry, in both languages.
    expect(filterCommands(cmds, 'go to heading', 'en')).toHaveLength(3)
    expect(cmds.map((c) => c.title('fa'))[0]).toBe('رفتن به عنوان H1 · Introduction')
    expect(filterCommands(cmds, 'رفتن به عنوان', 'fa')).toHaveLength(3)
  })

  it('empty headings are shown honestly, never with invented text', () => {
    const ed = makeEditor({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 } },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Real' }] },
      ],
    })
    const headings = extractLiveHeadings(ed.state.doc)
    expect(headings[0].empty).toBe(true)
    const cmds = buildHeadingCommands(headings, vi.fn())
    expect(cmds[0].title('en')).toBe('Go to heading H1 · (empty)')
    expect(cmds[0].title('fa')).toBe('رفتن به عنوان H1 · (خالی)')
    expect(cmds[1].title('en')).toBe('Go to heading H2 · Real')
  })

  it('duplicate heading texts still get unique command ids', () => {
    const ed = makeEditor({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Same' }] },
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Same' }] },
      ],
    })
    const cmds = buildHeadingCommands(extractLiveHeadings(ed.state.doc), vi.fn())
    expect(new Set(cmds.map((c) => c.id)).size).toBe(2)
  })
})

describe('no-headings case in buildCommands', () => {
  it('registers no per-heading commands when the document has no headings', () => {
    const cmds = buildCommands({ ...base, openNavigation: vi.fn(), listHeadings: () => [], jumpToHeading: vi.fn() })
    expect(cmds.some((c) => c.id.startsWith('go-to-heading:'))).toBe(false)
    // The pre-existing Navigation-pane opener is untouched by P2-12.
    expect(cmds.some((c) => c.id === 'go-to-heading')).toBe(true)
  })
  it('registers no per-heading commands without a heading source (dashboard)', () => {
    const cmds = buildCommands(base)
    expect(cmds.some((c) => c.id.startsWith('go-to-heading:'))).toBe(false)
  })
  it('buildCommands wires the live source: heading runs jump to contentPos', () => {
    const ed = makeEditor({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'body' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Sub' }] },
      ],
    })
    const headings = extractLiveHeadings(ed.state.doc)
    const jump = vi.fn()
    const cmds = buildCommands({
      ...base, openNavigation: vi.fn(),
      listHeadings: () => headings, jumpToHeading: jump,
    })
    const headingCmds = cmds.filter((c) => c.id.startsWith('go-to-heading:'))
    expect(headingCmds).toHaveLength(2)
    headingCmds[1].run()
    expect(jump).toHaveBeenCalledTimes(1)
    expect(jump).toHaveBeenCalledWith(headings[1].contentPos)
  })
})

describe('jump target position logic (pure part + live editor)', () => {
  it('contentPos is the first content character of the heading', () => {
    const ed = makeEditor({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'body' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Sub' }] },
      ],
    })
    const headings = extractLiveHeadings(ed.state.doc)
    expect(ed.state.doc.textBetween(headings[0].contentPos, headings[0].contentPos + 1)).toBe('T')
    expect(ed.state.doc.textBetween(headings[1].contentPos, headings[1].contentPos + 1)).toBe('S')
    // An empty heading's contentPos is still inside the heading node
    // (pos + 1), so a jump lands at the heading start, not in body text.
    const ed2 = makeEditor({ type: 'doc', content: [{ type: 'heading', attrs: { level: 1 } }] })
    const empty = extractLiveHeadings(ed2.state.doc)[0]
    expect(empty.contentPos).toBe(empty.from + 1)
  })

  it('jumping places the cursor at the heading start and mutates nothing', () => {
    const ed = makeEditor({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'body' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Sub' }] },
      ],
    })
    // Focus first: TipTap/ProseMirror itself normalises a doc ending in a
    // heading by appending a trailing empty paragraph on the first focus
    // transaction (pre-existing editor behaviour, also true of the
    // Navigation pane's jump). The snapshot is taken after that, so the
    // assertion below isolates what the jump itself does: nothing.
    ed.commands.focus()
    const before = JSON.stringify(ed.getJSON())
    const target = extractLiveHeadings(ed.state.doc)[1]
    jumpToPosition(ed as any, target.contentPos)
    expect(ed.state.selection.from).toBe(target.contentPos)
    expect(JSON.stringify(ed.getJSON())).toBe(before)
  })
})

describe('i18n for the new heading command key', () => {
  it('goToHeadingItem exists in both languages, distinct and non-empty', () => {
    expect(tr('en', 'goToHeadingItem')).toBe('Go to heading')
    expect(tr('fa', 'goToHeadingItem')).toBe('رفتن به عنوان')
    expect(tr('en', 'goToHeadingItem')).not.toBe(tr('fa', 'goToHeadingItem'))
  })
})
