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
    expect(r.counts).toEqual({ imageAltMissing: 0, headingSkip: 0, headingEmpty: 0, tableNoHeader: 0, linkEmptyText: 0, firstHeadingNotH1: 0, linkVagueText: 0, imageAltTooLong: 0, headingDuplicateText: 0, imageAltDuplicate: 0, imageAltIsFilename: 0, linkTextIsUrl: 0, imageAltVague: 0, headingNoContent: 0 })
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
    expect(r.counts).toEqual({ imageAltMissing: 1, headingSkip: 1, headingEmpty: 1, tableNoHeader: 1, linkEmptyText: 1, firstHeadingNotH1: 1, linkVagueText: 0, imageAltTooLong: 0, headingDuplicateText: 0, imageAltDuplicate: 0, imageAltIsFilename: 0, linkTextIsUrl: 0, imageAltVague: 0, headingNoContent: 0 })
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
    expect(r.counts).toEqual({ imageAltMissing: 1, headingSkip: 1, headingEmpty: 1, tableNoHeader: 1, linkEmptyText: 1, firstHeadingNotH1: 1, linkVagueText: 1, imageAltTooLong: 1, headingDuplicateText: 0, imageAltDuplicate: 0, imageAltIsFilename: 0, linkTextIsUrl: 0, imageAltVague: 0, headingNoContent: 0 })
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
    expect(r.counts).toEqual({ imageAltMissing: 1, headingSkip: 1, headingEmpty: 1, tableNoHeader: 1, linkEmptyText: 0, firstHeadingNotH1: 0, linkVagueText: 0, imageAltTooLong: 0, headingDuplicateText: 0, imageAltDuplicate: 0, imageAltIsFilename: 0, linkTextIsUrl: 0, imageAltVague: 0, headingNoContent: 0 })
    expect(r.total).toBe(4)
  })

  it('malformed and null input still yields no issues of any kind', () => {
    for (const bad of [null, undefined, {}, 'garbage', 42]) {
      const r = analyzeDoc(bad)
      expect(r.total).toBe(0)
      expect(r.counts).toEqual({ imageAltMissing: 0, headingSkip: 0, headingEmpty: 0, tableNoHeader: 0, linkEmptyText: 0, firstHeadingNotH1: 0, linkVagueText: 0, imageAltTooLong: 0, headingDuplicateText: 0, imageAltDuplicate: 0, imageAltIsFilename: 0, linkTextIsUrl: 0, imageAltVague: 0, headingNoContent: 0 })
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
})
