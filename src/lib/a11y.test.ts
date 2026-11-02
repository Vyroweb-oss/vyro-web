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
// A table cell carrying explicit span attrs (for P2-24 merged-cell tests).
const mergedCell = (text: string, header = false, attrs: any = {}) => ({
  type: header ? 'tableHeader' : 'tableCell',
  attrs,
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
// A text node carrying a link mark with no href at all, as TipTap
// stores a link whose destination was never set (P2-25 tests).
const linkedNoHref = (text: string) => ({
  type: 'text',
  text,
  marks: [{ type: 'link', attrs: {} }],
})
// A text node carrying a link mark with an arbitrary href value,
// including non-string values (P2-25 tests).
const linkedHrefAny = (text: string, href: any) => ({
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
const blockquote = (...content: any[]) => ({ type: 'blockquote', content })

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
    expect(r.counts).toEqual({ imageAltMissing: 0, headingSkip: 0, headingEmpty: 0, tableNoHeader: 0, linkEmptyText: 0, firstHeadingNotH1: 0, linkVagueText: 0, imageAltTooLong: 0, headingDuplicateText: 0, imageAltDuplicate: 0, imageAltIsFilename: 0, linkTextIsUrl: 0, imageAltVague: 0, headingNoContent: 0, tableMergedCells: 0, linkSameTextDifferentTarget: 0, linkMissingHref: 0, headingTooLong: 0, headingMultipleH1: 0, imageAltRedundantPrefix: 0 })
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
    // 'A cat on a sofa' — not a redundant-prefix alt (contrast P2-26:
    // 'Photo of a cat' now flags imageAltRedundantPrefix, so it is no
    // longer a clean-alt fixture).
    expect(analyzeDoc(doc(image('A cat on a sofa'))).total).toBe(0)
  })

  it('flags heading skips H1->H3 but H1->H2 is clean', () => {
    const skipped = analyzeDoc(doc(heading(1, 'A'), heading(3, 'B')))
    // Both headings also have no content (A's subsection B is not content,
    // and B trails the document), so headingNoContent fires for both.
    expect(skipped.issues).toEqual([
      { kind: 'headingSkip', headingIndex: 2, headingText: 'B', level: 3, prevLevel: 1 },
      { kind: 'headingNoContent', headingIndex: 1, headingText: 'A', level: 1 },
      { kind: 'headingNoContent', headingIndex: 2, headingText: 'B', level: 3 },
    ])
    // H1->H2 is not a skip, but both headings still have no content.
    const clean = analyzeDoc(doc(heading(1, 'A'), heading(2, 'B')))
    expect(clean.issues.filter((i) => i.kind === 'headingSkip')).toEqual([])
    expect(clean.issues.filter((i) => i.kind === 'headingNoContent')).toEqual([
      { kind: 'headingNoContent', headingIndex: 1, headingText: 'A', level: 1 },
      { kind: 'headingNoContent', headingIndex: 2, headingText: 'B', level: 2 },
    ])
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
    // Both headings also have no content (the H3 is a subsection of the
    // H1, and it trails the document), so headingNoContent fires for both.
    expect(r.issues).toEqual([
      { kind: 'headingSkip', headingIndex: 2, headingText: 'بخش دوم', level: 3, prevLevel: 1 },
      { kind: 'headingNoContent', headingIndex: 1, headingText: text, level: 1 },
      { kind: 'headingNoContent', headingIndex: 2, headingText: 'بخش دوم', level: 3 },
    ])
    // The ZWNJ heading itself is not empty and its text passes through untouched;
    // alone at the end of the document it has no content, so that is its only issue.
    const clean = analyzeDoc(doc(heading(1, text)))
    expect(clean.issues).toEqual([
      { kind: 'headingNoContent', headingIndex: 1, headingText: text, level: 1 },
    ])
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
    // H2->H3 is not a skip; the doc's issues are the first-heading issue
    // plus headingNoContent for both headings (the H3 is a subsection of
    // the H2, and it trails the document).
    expect(r.total).toBe(3)
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
    for (const bad of [null, undefined, {}, { type: 'doc' }, 'garbage', 42]) {
      expect(() => analyzeDoc(bad)).not.toThrow()
      expect(analyzeDoc(bad).total).toBe(0)
    }
    // P2-25: a link mark with no href but real text is no longer
    // "healthy" — it is exactly the linkMissingHref case, so this doc
    // still never throws but now contributes that one issue.
    const missingHrefDoc = doc(paraNodes(
      { type: 'text', text: 'plain', marks: null },
      { type: 'text', text: '', marks: [{ type: 'bold' }] },
      { type: 'text', text: 'x', marks: [{ type: 'link' }] },
    ))
    expect(() => analyzeDoc(missingHrefDoc)).not.toThrow()
    expect(analyzeDoc(missingHrefDoc).issues)
      .toEqual([{ kind: 'linkMissingHref', linkIndex: 1, href: '', linkText: 'x' }])
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
    // The heading is followed only by a paragraph whose link text is
    // empty, so it also has no content.
    expect(r.issues).toEqual([
      { kind: 'firstHeadingNotH1', headingIndex: 1, headingText: 'Opening', level: 2 },
      { kind: 'headingNoContent', headingIndex: 1, headingText: 'Opening', level: 2 },
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
    expect(r.counts).toEqual({ imageAltMissing: 1, headingSkip: 1, headingEmpty: 1, tableNoHeader: 1, linkEmptyText: 1, firstHeadingNotH1: 1, linkVagueText: 0, imageAltTooLong: 0, headingDuplicateText: 0, imageAltDuplicate: 0, imageAltIsFilename: 0, linkTextIsUrl: 0, imageAltVague: 0, headingNoContent: 0, tableMergedCells: 0, linkSameTextDifferentTarget: 0, linkMissingHref: 0, headingTooLong: 0, headingMultipleH1: 0, imageAltRedundantPrefix: 0 })
    expect(r.total).toBe(6)
  })

  it('flags every vague EN phrase once per run, with index, href and text', () => {
    const phrases = ['click here', 'here', 'this', 'link', 'more', 'read more', 'click']
    const r = analyzeDoc(doc(paraNodes(...phrases.map((p, i) => linked(p, `https://v${i}.example`)))))
    expect(r.issues.filter((i) => i.kind === 'linkVagueText')).toEqual(
      phrases.map((p, i) => ({ kind: 'linkVagueText', linkIndex: i + 1, href: `https://v${i}.example`, linkText: p })),
    )
    // Normalisation: case, extra whitespace and Arabic Yeh/Kaf still match.
    const norm = analyzeDoc(doc(paraNodes(
      linked('  CLICK   HERE  ', 'https://a.example'),
      linked('اينجا', 'https://b.example'),
    )))
    expect(norm.issues.filter((i) => i.kind === 'linkVagueText')).toEqual([
      { kind: 'linkVagueText', linkIndex: 1, href: 'https://a.example', linkText: 'CLICK   HERE' },
      { kind: 'linkVagueText', linkIndex: 2, href: 'https://b.example', linkText: 'اينجا' },
    ])
  })

  it('does NOT flag near-vague phrases: exact match only, never substring', () => {
    const r = analyzeDoc(doc(paraNodes(
      linked('click here for details', 'https://a.example'),
      linked('here we go', 'https://b.example'),
      linked('more information', 'https://c.example'),
      linked('this page', 'https://d.example'),
    )))
    expect(r.total).toBe(0)
    expect(r.counts.linkVagueText).toBe(0)
  })

  it('flags FA/Dari vague phrases', () => {
    const r = analyzeDoc(doc(paraNodes(
      linked('اینجا', 'https://a.example'),
      linked('اینجا کلیک کنید', 'https://b.example'),
      linked('کلیک کنید', 'https://c.example'),
      linked('لینک', 'https://d.example'),
      linked('بیشتر', 'https://e.example'),
      linked('برای جزئیات بیشتر اینجا کلیک کنید', 'https://f.example'),
    )))
    expect(r.issues.filter((i) => i.kind === 'linkVagueText').map((i) => i.linkIndex)).toEqual([1, 2, 3, 4, 5])
    // The longer sentence merely contains a vague phrase: not an exact match.
    expect(r.total).toBe(5)
  })

  it('counts a vague run split across same-href text nodes once', () => {
    const r = analyzeDoc(doc(paraNodes(linked('click ', 'https://x.example'), linked('here', 'https://x.example'))))
    expect(r.issues).toEqual([
      { kind: 'linkVagueText', linkIndex: 1, href: 'https://x.example', linkText: 'click here' },
    ])
  })

  it('an empty link is only linkEmptyText, never linkVagueText', () => {
    const r = analyzeDoc(doc(paraNodes(
      linked('', 'https://a.example'),
      linked('   ', 'https://b.example'),
    )))
    expect(r.issues).toEqual([
      { kind: 'linkEmptyText', linkIndex: 1, href: 'https://a.example' },
      { kind: 'linkEmptyText', linkIndex: 2, href: 'https://b.example' },
    ])
    expect(r.counts.linkVagueText).toBe(0)
  })

  it('flags alt text over 125 code points only; exactly 125 passes', () => {
    const r = analyzeDoc(doc(image('a'.repeat(125)), image('b'.repeat(126)), image('😀'.repeat(126))))
    // 126 emoji are 126 code points (252 UTF-16 units): the count is code points.
    expect(r.issues.filter((i) => i.kind === 'imageAltTooLong').map((i) => i.imageIndex)).toEqual([2, 3])
    expect(r.counts.imageAltMissing).toBe(0)
    // Whitespace around a 126-char alt does not hide it; padding around a
    // 125-char alt does not push it over (the trimmed length counts).
    expect(analyzeDoc(doc(image(`  ${'c'.repeat(126)}  `))).issues)
      .toEqual([{ kind: 'imageAltTooLong', imageIndex: 1 }])
    expect(analyzeDoc(doc(image(`  ${'d'.repeat(125)}  `))).total).toBe(0)
  })

  it('missing alt is only imageAltMissing, never imageAltTooLong', () => {
    const r = analyzeDoc(doc(image(), image(''), image('   '), image(null)))
    expect(r.issues.filter((i) => i.kind === 'imageAltMissing').map((i) => i.imageIndex)).toEqual([1, 2, 3, 4])
    expect(r.counts.imageAltTooLong).toBe(0)
  })

  it('counts all ten kinds together in one mixed doc', () => {
    const r = analyzeDoc(doc(
      heading(2, 'Title'),
      heading(4, ''),
      image(),
      image('e'.repeat(126)),
      table([[cell('A')]]),
      paraNodes(linked('', 'https://empty.example'), linked('click here', 'https://vague.example')),
    ))
    // First heading H2 + empty H4 + skip H2->H4 + missing alt + long alt
    // + table without header + empty link + vague link.
    expect(r.counts).toEqual({ imageAltMissing: 1, headingSkip: 1, headingEmpty: 1, tableNoHeader: 1, linkEmptyText: 1, firstHeadingNotH1: 1, linkVagueText: 1, imageAltTooLong: 1, headingDuplicateText: 0, imageAltDuplicate: 0, imageAltIsFilename: 0, linkTextIsUrl: 0, imageAltVague: 0, headingNoContent: 0, tableMergedCells: 0, linkSameTextDifferentTarget: 0, linkMissingHref: 0, headingTooLong: 0, headingMultipleH1: 0, imageAltRedundantPrefix: 0 })
    expect(r.total).toBe(8)
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
    expect(r.counts).toEqual({ imageAltMissing: 1, headingSkip: 1, headingEmpty: 1, tableNoHeader: 1, linkEmptyText: 0, firstHeadingNotH1: 0, linkVagueText: 0, imageAltTooLong: 0, headingDuplicateText: 0, imageAltDuplicate: 0, imageAltIsFilename: 0, linkTextIsUrl: 0, imageAltVague: 0, headingNoContent: 0, tableMergedCells: 0, linkSameTextDifferentTarget: 0, linkMissingHref: 0, headingTooLong: 0, headingMultipleH1: 0, imageAltRedundantPrefix: 0 })
    expect(r.total).toBe(4)
  })

  it('malformed and null input still yields no issues of any kind', () => {
    for (const bad of [null, undefined, {}, 'garbage', 42]) {
      const r = analyzeDoc(bad)
      expect(r.total).toBe(0)
      expect(r.counts).toEqual({ imageAltMissing: 0, headingSkip: 0, headingEmpty: 0, tableNoHeader: 0, linkEmptyText: 0, firstHeadingNotH1: 0, linkVagueText: 0, imageAltTooLong: 0, headingDuplicateText: 0, imageAltDuplicate: 0, imageAltIsFilename: 0, linkTextIsUrl: 0, imageAltVague: 0, headingNoContent: 0, tableMergedCells: 0, linkSameTextDifferentTarget: 0, linkMissingHref: 0, headingTooLong: 0, headingMultipleH1: 0, imageAltRedundantPrefix: 0 })
    }
  })

  it('flags an exact duplicate heading once, for the second occurrence only', () => {
    const r = analyzeDoc(doc(heading(1, 'Introduction'), heading(2, 'Introduction')))
    expect(r.issues.filter((i) => i.kind === 'headingDuplicateText')).toEqual([
      { kind: 'headingDuplicateText', headingIndex: 2, headingText: 'Introduction', level: 2 },
    ])
    // A single heading is its own first occurrence: never flagged.
    expect(analyzeDoc(doc(heading(1, 'Introduction'))).issues
      .filter((i) => i.kind === 'headingDuplicateText')).toEqual([])
  })

  it('flags each later occurrence of three identical headings (2 issues)', () => {
    const r = analyzeDoc(doc(heading(1, 'Summary'), heading(2, 'Summary'), heading(2, 'Summary')))
    expect(r.issues.filter((i) => i.kind === 'headingDuplicateText')).toEqual([
      { kind: 'headingDuplicateText', headingIndex: 2, headingText: 'Summary', level: 2 },
      { kind: 'headingDuplicateText', headingIndex: 3, headingText: 'Summary', level: 2 },
    ])
    expect(r.counts.headingDuplicateText).toBe(2)
  })

  it('distinct headings pass the duplicate-heading rule', () => {
    const r = analyzeDoc(doc(heading(1, 'Title'), heading(2, 'Section'), heading(2, 'Appendix')))
    expect(r.issues.filter((i) => i.kind === 'headingDuplicateText')).toEqual([])
    expect(r.counts.headingDuplicateText).toBe(0)
  })

  it('duplicate headings match case- and whitespace-insensitively, keeping original text', () => {
    const r = analyzeDoc(doc(heading(1, 'Introduction to Word'), heading(2, '  INTRODUCTION   to  Word ')))
    expect(r.issues.filter((i) => i.kind === 'headingDuplicateText')).toEqual([
      { kind: 'headingDuplicateText', headingIndex: 2, headingText: '  INTRODUCTION   to  Word ', level: 2 },
    ])
  })

  it('duplicate headings match across Arabic Yeh/Kaf vs Persian Yeh/Kaf', () => {
    const r = analyzeDoc(doc(
      heading(1, 'کتاب من'),
      heading(2, 'كتاب من'),
      heading(2, 'خانه‌ی من'),
      heading(2, 'خانه‌ي من'),
    ))
    expect(r.issues.filter((i) => i.kind === 'headingDuplicateText')).toEqual([
      { kind: 'headingDuplicateText', headingIndex: 2, headingText: 'كتاب من', level: 2 },
      { kind: 'headingDuplicateText', headingIndex: 4, headingText: 'خانه‌ي من', level: 2 },
    ])
  })

  it('empty headings are never flagged as duplicates', () => {
    const r = analyzeDoc(doc(heading(1, ''), heading(2, '   '), heading(2, 'Title')))
    expect(r.issues.filter((i) => i.kind === 'headingDuplicateText')).toEqual([])
    // The empties are still headingEmpty, just not duplicates.
    expect(r.issues.filter((i) => i.kind === 'headingEmpty')).toHaveLength(2)
  })

  it('flags an exact duplicate alt once, for the second image only', () => {
    const r = analyzeDoc(doc(image('A red apple'), image('A red apple')))
    expect(r.issues.filter((i) => i.kind === 'imageAltDuplicate')).toEqual([
      { kind: 'imageAltDuplicate', imageIndex: 2, altText: 'A red apple' },
    ])
    expect(analyzeDoc(doc(image('A red apple'))).issues
      .filter((i) => i.kind === 'imageAltDuplicate')).toEqual([])
  })

  it('duplicate alts match case- and whitespace-insensitively, with trimmed alt text', () => {
    const r = analyzeDoc(doc(image('Photo of a Cat'), image('  photo   of  a cat ')))
    expect(r.issues.filter((i) => i.kind === 'imageAltDuplicate')).toEqual([
      { kind: 'imageAltDuplicate', imageIndex: 2, altText: 'photo   of  a cat' },
    ])
  })

  it('distinct alts pass, and missing/empty alts are never flagged as duplicates', () => {
    const distinct = analyzeDoc(doc(image('A red apple'), image('A green apple')))
    expect(distinct.issues.filter((i) => i.kind === 'imageAltDuplicate')).toEqual([])
    const missing = analyzeDoc(doc(image(), image(''), image('   '), image(null)))
    expect(missing.issues.filter((i) => i.kind === 'imageAltDuplicate')).toEqual([])
    expect(missing.counts.imageAltMissing).toBe(4)
  })

  it('a duplicate long alt fires both imageAltTooLong and imageAltDuplicate', () => {
    const long = 'a'.repeat(126)
    const r = analyzeDoc(doc(image(long), image(long)))
    expect(r.issues.filter((i) => i.kind === 'imageAltTooLong').map((i) => i.imageIndex)).toEqual([1, 2])
    expect(r.issues.filter((i) => i.kind === 'imageAltDuplicate')).toEqual([
      { kind: 'imageAltDuplicate', imageIndex: 2, altText: long },
    ])
    expect(r.counts.imageAltTooLong).toBe(2)
    expect(r.counts.imageAltDuplicate).toBe(1)
  })

  it('flags filename alt text (photo.png, uppercase PHOTO.JPG, my-photo.webp) with index and alt text', () => {
    const r = analyzeDoc(doc(image('photo.png'), image('PHOTO.JPG'), image('my-photo.webp'), image('diagram.svg')))
    expect(r.issues.filter((i) => i.kind === 'imageAltIsFilename')).toEqual([
      { kind: 'imageAltIsFilename', imageIndex: 1, altText: 'photo.png' },
      { kind: 'imageAltIsFilename', imageIndex: 2, altText: 'PHOTO.JPG' },
      { kind: 'imageAltIsFilename', imageIndex: 3, altText: 'my-photo.webp' },
      { kind: 'imageAltIsFilename', imageIndex: 4, altText: 'diagram.svg' },
    ])
    expect(r.counts.imageAltIsFilename).toBe(4)
  })

  it('descriptive alt text passes the filename rule', () => {
    expect(analyzeDoc(doc(image('A red apple on a table'))).issues
      .filter((i) => i.kind === 'imageAltIsFilename')).toEqual([])
    expect(analyzeDoc(doc(image('A red apple'))).total).toBe(0)
  })

  it('alt with a filename inside a sentence passes (contains spaces)', () => {
    const r = analyzeDoc(doc(image('See photo.png for details'), image('The file my-photo.webp shows it')))
    expect(r.issues.filter((i) => i.kind === 'imageAltIsFilename')).toEqual([])
    expect(r.total).toBe(0)
  })

  it('alt with a non-image extension passes', () => {
    const r = analyzeDoc(doc(image('report.pdf'), image('notes.txt'), image('data.csv')))
    expect(r.issues.filter((i) => i.kind === 'imageAltIsFilename')).toEqual([])
    expect(r.total).toBe(0)
  })

  it('missing/empty alt is never flagged as a filename', () => {
    const r = analyzeDoc(doc(image(), image(''), image('   '), image(null)))
    expect(r.issues.filter((i) => i.kind === 'imageAltIsFilename')).toEqual([])
    expect(r.counts.imageAltMissing).toBe(4)
    expect(r.counts.imageAltIsFilename).toBe(0)
  })

  it('flags link text exactly its URL, with scheme/www/trailing-slash variants', () => {
    const r = analyzeDoc(doc(paraNodes(
      linked('https://example.com', 'https://example.com'),
      linked('example.com', 'http://www.example.com/'),
      linked('example.com', 'https://example.com'),
    )))
    expect(r.issues.filter((i) => i.kind === 'linkTextIsUrl')).toEqual([
      { kind: 'linkTextIsUrl', linkIndex: 1, href: 'https://example.com', linkText: 'https://example.com' },
      { kind: 'linkTextIsUrl', linkIndex: 2, href: 'http://www.example.com/', linkText: 'example.com' },
      { kind: 'linkTextIsUrl', linkIndex: 3, href: 'https://example.com', linkText: 'example.com' },
    ])
    expect(r.counts.linkTextIsUrl).toBe(3)
  })

  it('URL-text comparison is case-insensitive', () => {
    const r = analyzeDoc(doc(paraNodes(linked('EXAMPLE.COM', 'https://example.com'))))
    expect(r.issues).toEqual([
      { kind: 'linkTextIsUrl', linkIndex: 1, href: 'https://example.com', linkText: 'EXAMPLE.COM' },
    ])
  })

  it('descriptive link text passes the URL-text rule', () => {
    const r = analyzeDoc(doc(paraNodes(linked('Visit the site', 'https://example.com'))))
    expect(r.issues.filter((i) => i.kind === 'linkTextIsUrl')).toEqual([])
    expect(r.total).toBe(0)
  })

  it('an empty link is only linkEmptyText, never linkTextIsUrl', () => {
    const r = analyzeDoc(doc(paraNodes(
      linked('', 'https://a.example'),
      linked('   ', 'https://b.example'),
    )))
    expect(r.issues.filter((i) => i.kind === 'linkTextIsUrl')).toEqual([])
    expect(r.counts.linkTextIsUrl).toBe(0)
    expect(r.counts.linkEmptyText).toBe(2)
  })

  it('flags a URL-text link inside a list item and a table cell, with correct link index', () => {
    const r = analyzeDoc(doc(
      listItemNodes(linked('https://list.example', 'https://list.example')),
      table([[cellNodes(linked('cell.example', 'https://cell.example'))]]),
      paraNodes(linked('Fine', 'https://ok.example')),
    ))
    expect(r.issues.filter((i) => i.kind === 'linkTextIsUrl')).toEqual([
      { kind: 'linkTextIsUrl', linkIndex: 1, href: 'https://list.example', linkText: 'https://list.example' },
      { kind: 'linkTextIsUrl', linkIndex: 2, href: 'https://cell.example', linkText: 'cell.example' },
    ])
  })

  it('counts a URL-text run split across same-href text nodes once', () => {
    const r = analyzeDoc(doc(paraNodes(linked('https://exa', 'https://example.com'), linked('mple.com', 'https://example.com'))))
    expect(r.issues).toEqual([
      { kind: 'linkTextIsUrl', linkIndex: 1, href: 'https://example.com', linkText: 'https://example.com' },
    ])
  })

  // ---- P2-23: imageAltVague ----

  it('flags every generic alt word (EN and FA) with index and trimmed alt text', () => {
    const words = ['image', 'photo', 'picture', 'img', 'graphic', 'illustration', 'photograph', 'تصویر', 'عکس', 'نگاره']
    const r = analyzeDoc(doc(...words.map((w) => image(w))))
    expect(r.issues.filter((i) => i.kind === 'imageAltVague')).toEqual(
      words.map((w, i) => ({ kind: 'imageAltVague', imageIndex: i + 1, altText: w })),
    )
    expect(r.counts.imageAltVague).toBe(10)
  })

  it('does NOT flag descriptive alt text that merely contains a generic word', () => {
    const r = analyzeDoc(doc(image('a photo of a cat'), image('my photo from the trip')))
    expect(r.issues.filter((i) => i.kind === 'imageAltVague')).toEqual([])
    expect(r.total).toBe(0)
  })

  it('flags vague alt text despite surrounding whitespace and case differences', () => {
    const r = analyzeDoc(doc(image('  PHOTO  '), image('Image'), image('  عکس  ')))
    expect(r.issues.filter((i) => i.kind === 'imageAltVague')).toEqual([
      { kind: 'imageAltVague', imageIndex: 1, altText: 'PHOTO' },
      { kind: 'imageAltVague', imageIndex: 2, altText: 'Image' },
      { kind: 'imageAltVague', imageIndex: 3, altText: 'عکس' },
    ])
  })

  it('missing/empty alt is never flagged as vague alt', () => {
    const r = analyzeDoc(doc(image(), image(''), image('   '), image(null)))
    expect(r.issues.filter((i) => i.kind === 'imageAltVague')).toEqual([])
    expect(r.counts.imageAltMissing).toBe(4)
    expect(r.counts.imageAltVague).toBe(0)
  })

  it('a vague duplicate alt fires both imageAltVague and imageAltDuplicate', () => {
    const r = analyzeDoc(doc(image('photo'), image('photo')))
    expect(r.issues.filter((i) => i.kind === 'imageAltVague').map((i) => i.imageIndex)).toEqual([1, 2])
    expect(r.issues.filter((i) => i.kind === 'imageAltDuplicate')).toEqual([
      { kind: 'imageAltDuplicate', imageIndex: 2, altText: 'photo' },
    ])
    expect(r.counts.imageAltVague).toBe(2)
    expect(r.counts.imageAltDuplicate).toBe(1)
  })

  // ---- P2-23: headingNoContent ----

  it('a title heading followed by a subsection heading with body is not flagged', () => {
    const r = analyzeDoc(doc(heading(1, 'Title'), heading(2, 'Section'), para('Body text.')))
    expect(r.issues.filter((i) => i.kind === 'headingNoContent')).toEqual([])
  })

  it('flags earlier headings when a shallower heading ends their section, but not the headed one', () => {
    const r = analyzeDoc(doc(heading(1, 'A'), heading(2, 'B'), heading(1, 'C'), para('Body text.')))
    expect(r.issues.filter((i) => i.kind === 'headingNoContent')).toEqual([
      { kind: 'headingNoContent', headingIndex: 1, headingText: 'A', level: 1 },
      { kind: 'headingNoContent', headingIndex: 2, headingText: 'B', level: 2 },
    ])
  })

  it('flags a trailing heading at the end of the document', () => {
    const r = analyzeDoc(doc(heading(1, 'Title'), para('Body text.'), heading(2, 'Lonely')))
    expect(r.issues.filter((i) => i.kind === 'headingNoContent')).toEqual([
      { kind: 'headingNoContent', headingIndex: 2, headingText: 'Lonely', level: 2 },
    ])
  })

  it('flags a heading followed only by empty paragraphs', () => {
    const r = analyzeDoc(doc(heading(1, 'Title'), para(''), para('   ')))
    expect(r.issues.filter((i) => i.kind === 'headingNoContent')).toEqual([
      { kind: 'headingNoContent', headingIndex: 1, headingText: 'Title', level: 1 },
    ])
  })

  it('does not flag a heading followed by an image', () => {
    const r = analyzeDoc(doc(heading(1, 'Title'), image('A red apple')))
    expect(r.issues.filter((i) => i.kind === 'headingNoContent')).toEqual([])
  })

  it('does not flag a heading followed by a table with text', () => {
    const r = analyzeDoc(doc(heading(1, 'Title'), table([[cell('Name', true), cell('Value', true)]])))
    expect(r.issues.filter((i) => i.kind === 'headingNoContent')).toEqual([])
  })

  it('does not flag a heading nested inside a blockquote for this rule', () => {
    const r = analyzeDoc(doc(blockquote(heading(2, 'Nested'))))
    expect(r.issues.filter((i) => i.kind === 'headingNoContent')).toEqual([])
  })

  it('counts nested headings before a top-level heading when assigning its index', () => {
    const r = analyzeDoc(doc(
      blockquote(heading(2, 'Nested')),
      heading(1, 'Top'),
      para('Body text.'),
    ))
    // 'Top' is the second heading in extractHeadings order (after the
    // nested one), and it has body content, so it is not flagged — but
    // a trailing top-level heading after it would carry index 3.
    expect(r.issues.filter((i) => i.kind === 'headingNoContent')).toEqual([])
    const trailing = analyzeDoc(doc(
      blockquote(heading(2, 'Nested')),
      heading(1, 'Top'),
      para('Body text.'),
      heading(2, 'After'),
    ))
    expect(trailing.issues.filter((i) => i.kind === 'headingNoContent')).toEqual([
      { kind: 'headingNoContent', headingIndex: 3, headingText: 'After', level: 2 },
    ])
  })

  it('the clean-doc fixture still yields 0 for the no-content rule', () => {
    const r = analyzeDoc(doc(
      heading(1, 'Title'),
      heading(2, 'Section'),
      para('Body text.'),
      image('A red apple'),
      table([[cell('Name', true), cell('Value', true)], [cell('A'), cell('B')]]),
    ))
    expect(r.issues.filter((i) => i.kind === 'headingNoContent')).toEqual([])
    expect(r.counts.headingNoContent).toBe(0)
  })

  // ---- P2-24: tableMergedCells ----

  it('flags a table with a cell spanning two columns (colspan > 1)', () => {
    const r = analyzeDoc(doc(table([
      [cell('Name', true), cell('Value', true)],
      [mergedCell('Spans both', false, { colspan: 2 })],
    ])))
    expect(r.issues.filter((i) => i.kind === 'tableMergedCells')).toEqual([
      { kind: 'tableMergedCells', tableIndex: 1 },
    ])
  })

  it('flags a table with a cell spanning two rows (rowspan > 1), even in a later row', () => {
    const r = analyzeDoc(doc(table([
      [cell('Name', true), cell('Value', true)],
      [cell('A'), mergedCell('Tall', false, { rowspan: 2 })],
      [cell('B')],
    ])))
    expect(r.issues.filter((i) => i.kind === 'tableMergedCells')).toEqual([
      { kind: 'tableMergedCells', tableIndex: 1 },
    ])
  })

  it('flags a merged header cell', () => {
    const r = analyzeDoc(doc(table([
      [mergedCell('Title', true, { colspan: 2 })],
      [cell('A'), cell('B')],
    ])))
    expect(r.issues.filter((i) => i.kind === 'tableMergedCells')).toEqual([
      { kind: 'tableMergedCells', tableIndex: 1 },
    ])
  })

  it('does NOT flag colspan/rowspan of 1, absent attrs, or non-numeric spans', () => {
    const r = analyzeDoc(doc(table([
      [cell('Name', true), cell('Value', true)],
      [mergedCell('One', false, { colspan: 1, rowspan: 1 }), mergedCell('Str', false, { colspan: '2' })],
      [mergedCell('NoAttrs', false)],
    ])))
    expect(r.issues.filter((i) => i.kind === 'tableMergedCells')).toEqual([])
    expect(r.counts.tableMergedCells).toBe(0)
  })

  it('reports one merged-cell issue per table even with two merged cells', () => {
    const r = analyzeDoc(doc(table([
      [cell('Name', true), cell('Value', true)],
      [mergedCell('Wide', false, { colspan: 2 })],
      [mergedCell('Tall', false, { rowspan: 3 }), cell('B')],
    ])))
    expect(r.issues.filter((i) => i.kind === 'tableMergedCells')).toEqual([
      { kind: 'tableMergedCells', tableIndex: 1 },
    ])
    expect(r.counts.tableMergedCells).toBe(1)
  })

  it('counts tableIndex with a preceding clean table', () => {
    const r = analyzeDoc(doc(
      table([[cell('Name', true)], [cell('X')]]),
      table([[cell('Name', true), cell('Value', true)], [mergedCell('Wide', false, { colspan: 2 })]]),
    ))
    expect(r.issues.filter((i) => i.kind === 'tableMergedCells')).toEqual([
      { kind: 'tableMergedCells', tableIndex: 2 },
    ])
  })

  it('a merged-cell table with no header row fires both tableMergedCells and tableNoHeader', () => {
    const r = analyzeDoc(doc(table([
      [cell('A'), cell('B')],
      [mergedCell('Wide', false, { colspan: 2 })],
    ])))
    expect(r.issues.filter((i) => i.kind === 'tableNoHeader')).toEqual([
      { kind: 'tableNoHeader', tableIndex: 1 },
    ])
    expect(r.issues.filter((i) => i.kind === 'tableMergedCells')).toEqual([
      { kind: 'tableMergedCells', tableIndex: 1 },
    ])
    expect(r.counts.tableNoHeader).toBe(1)
    expect(r.counts.tableMergedCells).toBe(1)
  })

  // ---- P2-24: linkSameTextDifferentTarget ----

  it('[A, A, B] flags only the third run (the first new destination)', () => {
    // The two A runs are separated by plain text, so they stay distinct
    // runs (consecutive same-href nodes would merge into one run).
    const r = analyzeDoc(doc(paraNodes(
      linked('Visit', 'https://a.example'),
      { type: 'text', text: ' ' },
      linked('Visit', 'https://a.example'),
      linked('Visit', 'https://b.example'),
    )))
    expect(r.issues.filter((i) => i.kind === 'linkSameTextDifferentTarget')).toEqual([
      { kind: 'linkSameTextDifferentTarget', linkIndex: 3, href: 'https://b.example', linkText: 'Visit' },
    ])
  })

  it('[A, B, A] flags only the second run (the returning href is not new)', () => {
    const r = analyzeDoc(doc(paraNodes(
      linked('Visit', 'https://a.example'),
      linked('Visit', 'https://b.example'),
      linked('Visit', 'https://a.example'),
    )))
    expect(r.issues.filter((i) => i.kind === 'linkSameTextDifferentTarget')).toEqual([
      { kind: 'linkSameTextDifferentTarget', linkIndex: 2, href: 'https://b.example', linkText: 'Visit' },
    ])
  })

  it('a single-href group never flags', () => {
    const r = analyzeDoc(doc(paraNodes(
      linked('Visit', 'https://a.example'),
      linked('Visit', 'https://a.example'),
      linked('Other', 'https://b.example'),
    )))
    expect(r.issues.filter((i) => i.kind === 'linkSameTextDifferentTarget')).toEqual([])
    expect(r.counts.linkSameTextDifferentTarget).toBe(0)
    expect(r.total).toBe(0)
  })

  it('empty runs are excluded from this rule (they are already linkEmptyText)', () => {
    const r = analyzeDoc(doc(paraNodes(
      linked('', 'https://a.example'),
      linked('  ', 'https://b.example'),
    )))
    expect(r.issues.filter((i) => i.kind === 'linkSameTextDifferentTarget')).toEqual([])
    expect(r.issues.filter((i) => i.kind === 'linkEmptyText')).toHaveLength(2)
    // Empty runs also do not seed a group: a later real run is a first occurrence.
    // (Plain text separates the empty run from the Guide run, so they do
    // not merge into one run despite sharing an href.)
    const seeded = analyzeDoc(doc(paraNodes(
      linked('', 'https://a.example'),
      { type: 'text', text: ' ' },
      linked('Guide', 'https://a.example'),
      linked('Guide', 'https://b.example'),
    )))
    expect(seeded.issues.filter((i) => i.kind === 'linkSameTextDifferentTarget')).toEqual([
      { kind: 'linkSameTextDifferentTarget', linkIndex: 3, href: 'https://b.example', linkText: 'Guide' },
    ])
  })

  it('normalisation merges case, whitespace and Arabic-vs-Persian letter variants', () => {
    const r = analyzeDoc(doc(paraNodes(
      linked('Visit the Site', 'https://a.example'),
      linked('  visit   the  site ', 'https://b.example'),
    )))
    expect(r.issues.filter((i) => i.kind === 'linkSameTextDifferentTarget')).toEqual([
      { kind: 'linkSameTextDifferentTarget', linkIndex: 2, href: 'https://b.example', linkText: 'visit   the  site' },
    ])
    const fa = analyzeDoc(doc(paraNodes(
      linked('کتاب من', 'https://a.example'),
      linked('كتاب من', 'https://b.example'),
    )))
    expect(fa.issues.filter((i) => i.kind === 'linkSameTextDifferentTarget')).toEqual([
      { kind: 'linkSameTextDifferentTarget', linkIndex: 2, href: 'https://b.example', linkText: 'كتاب من' },
    ])
  })

  it('a run split across same-href text nodes counts once for this rule', () => {
    const r = analyzeDoc(doc(paraNodes(
      linked('Vis', 'https://a.example'),
      linked('it', 'https://a.example'),
      linked('Vi', 'https://b.example'),
      linked('sit', 'https://b.example'),
    )))
    // Two runs (indices 1 and 2), not four: only the second run flags.
    expect(r.issues.filter((i) => i.kind === 'linkSameTextDifferentTarget')).toEqual([
      { kind: 'linkSameTextDifferentTarget', linkIndex: 2, href: 'https://b.example', linkText: 'Visit' },
    ])
  })

  it('a vague-text link pair to different destinations fires both rules', () => {
    const r = analyzeDoc(doc(paraNodes(
      linked('click here', 'https://a.example'),
      linked('click here', 'https://b.example'),
    )))
    expect(r.issues.filter((i) => i.kind === 'linkVagueText')).toHaveLength(2)
    expect(r.issues.filter((i) => i.kind === 'linkSameTextDifferentTarget')).toEqual([
      { kind: 'linkSameTextDifferentTarget', linkIndex: 2, href: 'https://b.example', linkText: 'click here' },
    ])
  })

  // P2-25, rule 17: links with no destination.
  it('a link with no href at all flags linkMissingHref', () => {
    const r = analyzeDoc(doc(paraNodes(linkedNoHref('Guide'))))
    expect(r.issues.filter((i) => i.kind === 'linkMissingHref')).toEqual([
      { kind: 'linkMissingHref', linkIndex: 1, href: '', linkText: 'Guide' },
    ])
  })

  it('a link with an empty href flags linkMissingHref', () => {
    const r = analyzeDoc(doc(paraNodes(linked('Guide', ''))))
    expect(r.issues.filter((i) => i.kind === 'linkMissingHref')).toEqual([
      { kind: 'linkMissingHref', linkIndex: 1, href: '', linkText: 'Guide' },
    ])
  })

  it('a link with a whitespace-only href flags linkMissingHref with href empty', () => {
    const r = analyzeDoc(doc(paraNodes(linked('Guide', '   '))))
    expect(r.issues.filter((i) => i.kind === 'linkMissingHref')).toEqual([
      { kind: 'linkMissingHref', linkIndex: 1, href: '', linkText: 'Guide' },
    ])
  })

  it('a link with a non-string href flags linkMissingHref', () => {
    const r = analyzeDoc(doc(paraNodes(linkedHrefAny('Guide', 123))))
    expect(r.issues.filter((i) => i.kind === 'linkMissingHref')).toEqual([
      { kind: 'linkMissingHref', linkIndex: 1, href: '', linkText: 'Guide' },
    ])
  })

  it('a link with a valid href does not flag linkMissingHref', () => {
    const r = analyzeDoc(doc(paraNodes(linked('Guide', 'https://example.com'))))
    expect(r.issues.filter((i) => i.kind === 'linkMissingHref')).toEqual([])
    expect(r.total).toBe(0)
  })

  it('an empty-text link with no href fires only linkEmptyText, not linkMissingHref', () => {
    const r = analyzeDoc(doc(
      paraNodes(linkedNoHref('')),
      paraNodes(linkedNoHref('  ')),
    ))
    expect(r.issues.filter((i) => i.kind === 'linkEmptyText')).toHaveLength(2)
    expect(r.issues.filter((i) => i.kind === 'linkMissingHref')).toEqual([])
  })

  it('a missing-href run split across text nodes counts once', () => {
    const r = analyzeDoc(doc(paraNodes(linkedNoHref('Gui'), linkedNoHref('de'))))
    expect(r.issues.filter((i) => i.kind === 'linkMissingHref')).toEqual([
      { kind: 'linkMissingHref', linkIndex: 1, href: '', linkText: 'Guide' },
    ])
  })

  it('a vague-text link with no href fires both linkVagueText and linkMissingHref', () => {
    const r = analyzeDoc(doc(paraNodes(linkedNoHref('click here'))))
    expect(r.issues.filter((i) => i.kind === 'linkVagueText')).toEqual([
      { kind: 'linkVagueText', linkIndex: 1, href: '', linkText: 'click here' },
    ])
    expect(r.issues.filter((i) => i.kind === 'linkMissingHref')).toEqual([
      { kind: 'linkMissingHref', linkIndex: 1, href: '', linkText: 'click here' },
    ])
    expect(r.issues.filter((i) => i.kind === 'linkTextIsUrl')).toEqual([])
  })

  // P2-25, rule 18: headings that are too long.
  it('a heading of exactly 100 code points passes', () => {
    const r = analyzeDoc(doc(heading(1, 'a'.repeat(100)), para('Body.')))
    expect(r.issues.filter((i) => i.kind === 'headingTooLong')).toEqual([])
    expect(r.total).toBe(0)
  })

  it('a heading of 101 code points flags headingTooLong with the original text', () => {
    const long = 'a'.repeat(101)
    const r = analyzeDoc(doc(heading(1, long), para('Body.')))
    expect(r.issues.filter((i) => i.kind === 'headingTooLong')).toEqual([
      { kind: 'headingTooLong', headingIndex: 1, headingText: long, level: 1 },
    ])
  })

  it('heading length counts code points, not UTF-16 units', () => {
    // 51 emoji = 51 code points (but 102 UTF-16 units): passes.
    const passing = analyzeDoc(doc(heading(1, '😀'.repeat(51)), para('Body.')))
    expect(passing.issues.filter((i) => i.kind === 'headingTooLong')).toEqual([])
    // 101 emoji = 101 code points: flags.
    const flagging = analyzeDoc(doc(heading(1, '😀'.repeat(101)), para('Body.')))
    expect(flagging.issues.filter((i) => i.kind === 'headingTooLong')).toHaveLength(1)
  })

  it('a long Persian heading flags headingTooLong', () => {
    const faLong = 'دسترس‌پذیری '.repeat(9)
    expect([...faLong.trim()].length).toBeGreaterThan(100)
    const r = analyzeDoc(doc(heading(1, faLong), para('متن.')))
    expect(r.issues.filter((i) => i.kind === 'headingTooLong')).toEqual([
      { kind: 'headingTooLong', headingIndex: 1, headingText: faLong, level: 1 },
    ])
  })

  it('a whitespace-padded heading counts its trimmed length', () => {
    const passing = analyzeDoc(doc(heading(1, `   ${'b'.repeat(100)}   `), para('Body.')))
    expect(passing.issues.filter((i) => i.kind === 'headingTooLong')).toEqual([])
    const flagging = analyzeDoc(doc(heading(1, `  ${'b'.repeat(101)}  `), para('Body.')))
    expect(flagging.issues.filter((i) => i.kind === 'headingTooLong')).toHaveLength(1)
    expect(flagging.issues.filter((i) => i.kind === 'headingTooLong')[0].headingText)
      .toBe(`  ${'b'.repeat(101)}  `)
  })

  it('a long heading fires alongside other heading rules independently', () => {
    const long = 'x'.repeat(101)
    const r = analyzeDoc(doc(heading(1, long), para('Body.'), heading(3, long)))
    expect(r.issues.filter((i) => i.kind === 'headingTooLong').map((i) => i.headingIndex)).toEqual([1, 2])
    expect(r.issues.filter((i) => i.kind === 'headingDuplicateText')).toEqual([
      { kind: 'headingDuplicateText', headingIndex: 2, headingText: long, level: 3 },
    ])
    expect(r.issues.filter((i) => i.kind === 'headingSkip')).toHaveLength(1)
  })

  // P2-26, rule 19: multiple Heading 1 headings.
  it('a single H1 passes the multiple-H1 rule', () => {
    const r = analyzeDoc(doc(heading(1, 'Title'), para('Body.')))
    expect(r.issues.filter((i) => i.kind === 'headingMultipleH1')).toEqual([])
    expect(r.total).toBe(0)
  })

  it('two H1 headings flag only the second', () => {
    const r = analyzeDoc(doc(heading(1, 'Intro'), para('Body.'), heading(1, 'Details'), para('More.')))
    expect(r.issues.filter((i) => i.kind === 'headingMultipleH1')).toEqual([
      { kind: 'headingMultipleH1', headingIndex: 2, headingText: 'Details', level: 1 },
    ])
    expect(r.counts.headingMultipleH1).toBe(1)
  })

  it('three H1 headings flag the second and third', () => {
    const r = analyzeDoc(doc(heading(1, 'One'), para('A.'), heading(1, 'Two'), para('B.'), heading(1, 'Three'), para('C.')))
    expect(r.issues.filter((i) => i.kind === 'headingMultipleH1').map((i) => i.headingIndex)).toEqual([2, 3])
    expect(r.issues.filter((i) => i.kind === 'headingMultipleH1')).toEqual([
      { kind: 'headingMultipleH1', headingIndex: 2, headingText: 'Two', level: 1 },
      { kind: 'headingMultipleH1', headingIndex: 3, headingText: 'Three', level: 1 },
    ])
  })

  it('H2 headings never flag the multiple-H1 rule', () => {
    const r = analyzeDoc(doc(heading(2, 'One'), para('A.'), heading(2, 'Two'), para('B.')))
    expect(r.issues.filter((i) => i.kind === 'headingMultipleH1')).toEqual([])
  })

  it('an empty second H1 is excluded from the multiple-H1 rule', () => {
    const r = analyzeDoc(doc(heading(1, 'Title'), para('Body.'), heading(1, '')))
    expect(r.issues.filter((i) => i.kind === 'headingMultipleH1')).toEqual([])
    expect(r.issues.filter((i) => i.kind === 'headingEmpty')).toHaveLength(1)
  })

  it('a second H1 with duplicate text fires both multiple-H1 and duplicate-text', () => {
    const r = analyzeDoc(doc(heading(1, 'Title'), para('Body.'), heading(1, 'Title'), para('More.')))
    expect(r.issues.filter((i) => i.kind === 'headingMultipleH1')).toEqual([
      { kind: 'headingMultipleH1', headingIndex: 2, headingText: 'Title', level: 1 },
    ])
    expect(r.issues.filter((i) => i.kind === 'headingDuplicateText')).toEqual([
      { kind: 'headingDuplicateText', headingIndex: 2, headingText: 'Title', level: 1 },
    ])
  })

  // P2-26, rule 20: alt text with a redundant opening word.
  it('flags every redundant-prefix alt (EN and FA, punctuation and case variants)', () => {
    const alts = [
      'Image of a cat', 'Photo: sunset', 'picture of dog', 'عکس یک گربه', 'تصویر: غروب',
      'PHOTO: sunset', 'Image, a cat', 'Illustration of a scene', 'graphic of a chart',
    ]
    const r = analyzeDoc(doc(...alts.map((a) => image(a))))
    expect(r.issues.filter((i) => i.kind === 'imageAltRedundantPrefix')).toEqual(
      alts.map((a, i) => ({ kind: 'imageAltRedundantPrefix', imageIndex: i + 1, altText: a })),
    )
    expect(r.counts.imageAltRedundantPrefix).toBe(alts.length)
  })

  it('does NOT flag redundant-prefix lookalikes: later word, exact vague, or filename', () => {
    for (const alt of ['A photo of a cat', 'Sample photo', 'photo', 'photo.png']) {
      const r = analyzeDoc(doc(image(alt)))
      expect(r.issues.filter((i) => i.kind === 'imageAltRedundantPrefix')).toEqual([])
      expect(r.counts.imageAltRedundantPrefix).toBe(0)
    }
    // 'photo' alone is vague-only; 'photo.png' is filename-only.
    expect(analyzeDoc(doc(image('photo'))).issues.filter((i) => i.kind === 'imageAltVague')).toHaveLength(1)
    expect(analyzeDoc(doc(image('photo.png'))).issues.filter((i) => i.kind === 'imageAltIsFilename')).toHaveLength(1)
  })

  it('missing/empty alt is never flagged as a redundant prefix', () => {
    const r = analyzeDoc(doc(image(), image(''), image('   '), image(null)))
    expect(r.issues.filter((i) => i.kind === 'imageAltRedundantPrefix')).toEqual([])
    expect(r.counts.imageAltMissing).toBe(4)
    expect(r.counts.imageAltRedundantPrefix).toBe(0)
  })

  it('a mixed doc with both P2-26 rules reports full counts over 20 kinds', () => {
    const r = analyzeDoc(doc(
      heading(1, 'Title'),
      para('Body.'),
      heading(1, 'Second'),
      para('More.'),
      image('Photo: sunset'),
    ))
    expect(r.total).toBe(2)
    expect(r.counts).toEqual({ imageAltMissing: 0, headingSkip: 0, headingEmpty: 0, tableNoHeader: 0, linkEmptyText: 0, firstHeadingNotH1: 0, linkVagueText: 0, imageAltTooLong: 0, headingDuplicateText: 0, imageAltDuplicate: 0, imageAltIsFilename: 0, linkTextIsUrl: 0, imageAltVague: 0, headingNoContent: 0, tableMergedCells: 0, linkSameTextDifferentTarget: 0, linkMissingHref: 0, headingTooLong: 0, headingMultipleH1: 1, imageAltRedundantPrefix: 1 })
  })

  it('a mixed doc with both new rules reports full counts over 20 kinds', () => {
    const r = analyzeDoc(doc(
      heading(1, 'c'.repeat(101)),
      paraNodes(linkedNoHref('Guide')),
      image('A red apple'),
      table([[cell('Name', true)], [cell('A')]]),
    ))
    expect(r.total).toBe(2)
    expect(r.counts).toEqual({ imageAltMissing: 0, headingSkip: 0, headingEmpty: 0, tableNoHeader: 0, linkEmptyText: 0, firstHeadingNotH1: 0, linkVagueText: 0, imageAltTooLong: 0, headingDuplicateText: 0, imageAltDuplicate: 0, imageAltIsFilename: 0, linkTextIsUrl: 0, imageAltVague: 0, headingNoContent: 0, tableMergedCells: 0, linkSameTextDifferentTarget: 0, linkMissingHref: 1, headingTooLong: 1, headingMultipleH1: 0, imageAltRedundantPrefix: 0 })
  })
})
