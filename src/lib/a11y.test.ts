import { describe, it, expect } from 'vitest'
import { analyzeDoc } from './a11y'

// Tiny TipTap-JSON builders (same shapes the editor stores).
const para = (text: string) => ({
  type: 'paragraph',
  content: text ? [{ type: 'text', text }] : [],
})
const heading = (level: number, text: string) => ({
  type: 'heading',
  attrs: { level },
  content: text ? [{ type: 'text', text }] : [],
})
const image = (alt?: string | null) => ({
  type: 'image',
  attrs: alt === undefined ? {} : { alt, src: 'x.png' },
})
const cell = (text: string, header = false) => ({
  type: header ? 'tableHeader' : 'tableCell',
  content: [para(text)],
})
const table = (rows: any[][]) => ({
  type: 'table',
  content: rows.map((cells) => ({ type: 'tableRow', content: cells })),
})
const doc = (...content: any[]) => ({ type: 'doc', content })
// A text node carrying a link mark, as TipTap stores it.
const linked = (text: string, href: string) => ({
  type: 'text',
  text,
  marks: [{ type: 'link', attrs: { href } }],
})
const paraNodes = (...nodes: any[]) => ({ type: 'paragraph', content: nodes })
const listItemNodes = (...nodes: any[]) => ({
  type: 'listItem',
  content: [paraNodes(...nodes)],
})
const cellNodes = (...nodes: any[]) => ({ type: 'tableCell', content: [paraNodes(...nodes)] })

function deepFreeze(v: any): any {
  if (v && typeof v === 'object') {
    Object.values(v).forEach(deepFreeze)
    Object.freeze(v)
  }
  return v
}

describe('a11y analyzeDoc', () => {
  it('clean doc has no issues', () => {
    const r = analyzeDoc(doc(
      heading(1, 'Title'),
      heading(2, 'Section'),
      para('Body text.'),
      image('A red apple'),
      table([[cell('Name', true), cell('Value', true)], [cell('A'), cell('B')]]),
    ))
    expect(r.total).toBe(0)
    expect(r.issues).toEqual([])
    expect(r.counts).toEqual({ imageAltMissing: 0, headingSkip: 0, headingEmpty: 0, tableNoHeader: 0, linkEmptyText: 0, firstHeadingNotH1: 0 })
  })

  it('empty doc and null input have no issues', () => {
    expect(analyzeDoc(doc()).total).toBe(0)
    expect(analyzeDoc(null).total).toBe(0)
    expect(analyzeDoc(undefined).total).toBe(0)
    expect(analyzeDoc({ type: 'doc', content: [] }).total).toBe(0)
  })

  it('flags images missing alt text (missing, empty, whitespace) with 1-based index', () => {
    const r = analyzeDoc(doc(image(), image('  '), image(null), para('x')))
    expect(r.issues.filter((i) => i.kind === 'imageAltMissing').map((i) => i.imageIndex))
      .toEqual([1, 2, 3])
  })

  it('image WITH alt text passes', () => {
    expect(analyzeDoc(doc(image('Photo of a cat'))).total).toBe(0)
  })

  it('flags heading skips H1->H3 but H1->H2 is clean', () => {
    const skipped = analyzeDoc(doc(heading(1, 'A'), heading(3, 'B')))
    expect(skipped.issues).toEqual([{
      kind: 'headingSkip', headingIndex: 2, headingText: 'B', level: 3, prevLevel: 1,
    }])
    expect(analyzeDoc(doc(heading(1, 'A'), heading(2, 'B'))).total).toBe(0)
    // Going shallower is never a skip, and the first heading has no predecessor
    // for the skip rule (the separate firstHeadingNotH1 rule may still fire).
    expect(analyzeDoc(doc(heading(3, 'A'), heading(1, 'B'))).issues.filter((i) => i.kind === 'headingSkip')).toEqual([])
  })

  it('flags empty headings with their level and index', () => {
    const r = analyzeDoc(doc(heading(1, 'Title'), heading(2, ''), heading(2, '   ')))
    expect(r.issues.filter((i) => i.kind === 'headingEmpty')).toEqual([
      { kind: 'headingEmpty', headingIndex: 2, headingText: '', level: 2 },
      { kind: 'headingEmpty', headingIndex: 3, headingText: '   ', level: 2 },
    ])
  })

  it('flags tables whose first row has no header cell, with 1-based index', () => {
    const r = analyzeDoc(doc(
      table([[cell('A'), cell('B')], [cell('C'), cell('D')]]),
      table([[cell('Name', true)], [cell('X')]]),
    ))
    expect(r.issues.filter((i) => i.kind === 'tableNoHeader').map((i) => i.tableIndex)).toEqual([1])
  })

  it('table with a header row passes, even with a single header cell', () => {
    expect(analyzeDoc(doc(table([[cell('Name', true), cell('Other')], [cell('X'), cell('Y')]]))).total).toBe(0)
  })

  it('handles FA/Dari headings including ZWNJ text without normalising it', () => {
    const text = 'می‌کنم و کتاب‌های من'
    const r = analyzeDoc(doc(heading(1, text), heading(3, 'بخش دوم')))
    expect(r.issues).toEqual([{
      kind: 'headingSkip', headingIndex: 2, headingText: 'بخش دوم', level: 3, prevLevel: 1,
    }])
    // The ZWNJ heading itself is not empty and its text passes through untouched.
    const clean = analyzeDoc(doc(heading(1, text)))
    expect(clean.total).toBe(0)
    expect(analyzeDoc(doc(heading(1, 'مقدمه'), heading(2, ''))).issues[0].headingText).toBe('')
  })

  it('never mutates its input (deep-frozen doc analyses cleanly)', () => {
    const input = deepFreeze(doc(
      heading(1, 'Title'),
      heading(3, 'Skipped'),
      image(),
      table([[cell('A')]]),
    ))
    const before = JSON.stringify(input)
    const r = analyzeDoc(input)
    expect(r.total).toBe(3)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('flags links with empty or whitespace-only text, with 1-based link index and href', () => {
    const r = analyzeDoc(doc(paraNodes(
      linked('', 'https://a.example'),
      linked('  ', 'https://b.example'),
      linked('Click here', 'https://c.example'),
    )))
    expect(r.issues.filter((i) => i.kind === 'linkEmptyText')).toEqual([
      { kind: 'linkEmptyText', linkIndex: 1, href: 'https://a.example' },
      { kind: 'linkEmptyText', linkIndex: 2, href: 'https://b.example' },
    ])
    // The well-formed link counts toward the index but raises no issue:
    // a later empty link would be index 4.
    const later = analyzeDoc(doc(paraNodes(
      linked('One', 'https://a.example'),
      linked('Two', 'https://b.example'),
      linked('Three', 'https://c.example'),
      linked('', 'https://d.example'),
    )))
    expect(later.issues).toEqual([{ kind: 'linkEmptyText', linkIndex: 4, href: 'https://d.example' }])
  })

  it('link with real visible text passes', () => {
    expect(analyzeDoc(doc(paraNodes(linked('Visit the site', 'https://example.com')))).total).toBe(0)
  })

  it('flags a first heading above H1 exactly once, with its level and text', () => {
    const r = analyzeDoc(doc(heading(2, 'Opening'), heading(3, 'Later')))
    expect(r.issues.filter((i) => i.kind === 'firstHeadingNotH1')).toEqual([
      { kind: 'firstHeadingNotH1', headingIndex: 1, headingText: 'Opening', level: 2 },
    ])
    // H2->H3 is not a skip, so this doc has exactly the one new issue.
    expect(r.total).toBe(1)
    // An empty first heading above H1 still reports its level (bare text '').
    expect(analyzeDoc(doc(heading(3, ''))).issues.filter((i) => i.kind === 'firstHeadingNotH1'))
      .toEqual([{ kind: 'firstHeadingNotH1', headingIndex: 1, headingText: '', level: 3 }])
  })

  it('first heading H1, and a doc with no headings, pass the first-heading rule', () => {
    expect(analyzeDoc(doc(heading(1, 'Title'), heading(2, 'Section'))).issues
      .filter((i) => i.kind === 'firstHeadingNotH1')).toEqual([])
    expect(analyzeDoc(doc(para('Just body text.'))).issues
      .filter((i) => i.kind === 'firstHeadingNotH1')).toEqual([])
  })

  it('counts a link split across text nodes once, and re-counts it after a break', () => {
    // Empty across two nodes sharing one href: one issue, not two.
    const split = analyzeDoc(doc(paraNodes(linked('', 'https://x.example'), linked('  ', 'https://x.example'))))
    expect(split.issues).toEqual([{ kind: 'linkEmptyText', linkIndex: 1, href: 'https://x.example' }])
    // Real text split across nodes is one healthy link, not an issue.
    expect(analyzeDoc(doc(paraNodes(linked('Hel', 'https://x.example'), linked('lo', 'https://x.example')))).total).toBe(0)
    // The same href separated by plain text is two distinct links.
    const broken = analyzeDoc(doc(paraNodes(
      linked('', 'https://x.example'),
      { type: 'text', text: ' ' },
      linked('', 'https://x.example'),
    )))
    expect(broken.issues).toEqual([
      { kind: 'linkEmptyText', linkIndex: 1, href: 'https://x.example' },
      { kind: 'linkEmptyText', linkIndex: 2, href: 'https://x.example' },
    ])
  })

  it('flags empty links nested inside list items and table cells', () => {
    const r = analyzeDoc(doc(
      listItemNodes(linked('', 'https://list.example')),
      table([[cellNodes(linked('  ', 'https://cell.example'))]]),
      paraNodes(linked('Fine', 'https://ok.example')),
    ))
    expect(r.issues.filter((i) => i.kind === 'linkEmptyText')).toEqual([
      { kind: 'linkEmptyText', linkIndex: 1, href: 'https://list.example' },
      { kind: 'linkEmptyText', linkIndex: 2, href: 'https://cell.example' },
    ])
  })

  it('malformed and null input yields no issues and never throws', () => {
    for (const bad of [null, undefined, {}, { type: 'doc' }, 'garbage', 42, doc(paraNodes(
      { type: 'text', text: 'plain', marks: null },
      { type: 'text', text: '', marks: [{ type: 'bold' }] },
      { type: 'text', text: 'x', marks: [{ type: 'link' }] },
    ))]) {
      expect(() => analyzeDoc(bad)).not.toThrow()
      // The last doc holds only a healthy link (a link mark with no href
      // but real text), so it too contributes no issue.
      expect(analyzeDoc(bad).total).toBe(0)
    }
    // A link mark with no href and empty text is still an empty link.
    expect(analyzeDoc(doc(paraNodes({ type: 'text', text: '', marks: [{ type: 'link' }] }))).issues)
      .toEqual([{ kind: 'linkEmptyText', linkIndex: 1, href: '' }])
  })

  it('never mutates deep-frozen input containing the new issues', () => {
    const input = deepFreeze(doc(
      heading(2, 'Opening'),
      paraNodes(linked('', 'https://x.example')),
    ))
    const before = JSON.stringify(input)
    const r = analyzeDoc(input)
    expect(r.issues).toEqual([
      { kind: 'firstHeadingNotH1', headingIndex: 1, headingText: 'Opening', level: 2 },
      { kind: 'linkEmptyText', linkIndex: 1, href: 'https://x.example' },
    ])
    expect(JSON.stringify(input)).toBe(before)
  })

  it('counts old and new rules together in one mixed doc', () => {
    const r = analyzeDoc(doc(
      heading(2, 'Title'),
      heading(4, ''),
      image(),
      table([[cell('A')]]),
      paraNodes(linked('', 'https://x.example')),
    ))
    // First heading H2 + empty H4 + skip H2->H4 + image + table + empty link.
    expect(r.counts).toEqual({ imageAltMissing: 1, headingSkip: 1, headingEmpty: 1, tableNoHeader: 1, linkEmptyText: 1, firstHeadingNotH1: 1 })
    expect(r.total).toBe(6)
  })

  it('counts each check independently in one mixed doc', () => {
    const r = analyzeDoc(doc(
      heading(1, 'Title'),
      heading(3, ''),
      image(),
      table([[cell('A')]]),
    ))
    // Empty heading + skip (H1->H3 on the empty heading) + image + table.
    // First heading is H1 and there are no links, so the two new rules add 0.
    expect(r.counts).toEqual({ imageAltMissing: 1, headingSkip: 1, headingEmpty: 1, tableNoHeader: 1, linkEmptyText: 0, firstHeadingNotH1: 0 })
    expect(r.total).toBe(4)
  })
})
