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
    expect(r.counts).toEqual({ imageAltMissing: 0, headingSkip: 0, headingEmpty: 0, tableNoHeader: 0 })
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
    // Going shallower is never a skip, and the first heading has no predecessor.
    expect(analyzeDoc(doc(heading(3, 'A'), heading(1, 'B'))).total).toBe(0)
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

  it('counts each check independently in one mixed doc', () => {
    const r = analyzeDoc(doc(
      heading(1, 'Title'),
      heading(3, ''),
      image(),
      table([[cell('A')]]),
    ))
    // Empty heading + skip (H1->H3 on the empty heading) + image + table.
    expect(r.counts).toEqual({ imageAltMissing: 1, headingSkip: 1, headingEmpty: 1, tableNoHeader: 1 })
    expect(r.total).toBe(4)
  })
})
