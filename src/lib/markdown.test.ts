import { describe, it, expect } from 'vitest'
import { jsonToMarkdown } from './markdown'

const text = (t: string, marks?: any[]) => ({ type: 'text', text: t, ...(marks ? { marks } : {}) })
const para = (...content: any[]) => ({ type: 'paragraph', content })
const heading = (level: any, ...content: any[]) => ({ type: 'heading', attrs: { level }, content })
const doc = (...content: any[]) => ({ type: 'doc', content })
const li = (...content: any[]) => ({ type: 'listItem', content })
const cell = (t: string) => ({ type: 'tableCell', content: [para(text(t))] })
const headerCell = (t: string) => ({ type: 'tableHeader', content: [para(text(t))] })
const row = (...cells: any[]) => ({ type: 'tableRow', content: cells })

describe('jsonToMarkdown', () => {
  it('headings H1–H6, clamping, and missing level defaulting to 1', () => {
    expect(jsonToMarkdown(doc(heading(1, text('One'))))).toBe('# One')
    expect(jsonToMarkdown(doc(heading(3, text('Three'))))).toBe('### Three')
    expect(jsonToMarkdown(doc(heading(9, text('Clamped'))))).toBe('###### Clamped')
    expect(jsonToMarkdown(doc(heading(0, text('Low'))))).toBe('# Low')
    expect(jsonToMarkdown(doc({ type: 'heading', content: [text('No level')] }))).toBe('# No level')
  })
  it('bold, italic, strike and code marks', () => {
    const d = doc(para(
      text('b', [{ type: 'bold' }]), text(' '),
      text('i', [{ type: 'italic' }]), text(' '),
      text('s', [{ type: 'strike' }]), text(' '),
      text('c', [{ type: 'code' }]),
    ))
    expect(jsonToMarkdown(d)).toBe('**b** *i* ~~s~~ `c`')
  })
  it('safe link exports, unsafe javascript: link degrades to plain text', () => {
    const safe = doc(para(text('site', [{ type: 'link', attrs: { href: 'https://example.com' } }])))
    expect(jsonToMarkdown(safe)).toBe('[site](https://example.com)')
    const unsafe = doc(para(text('click', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }])))
    expect(jsonToMarkdown(unsafe)).toBe('click')
  })
  it('bullet list with a nested bullet list indented 2 spaces per depth', () => {
    const d = doc({ type: 'bulletList', content: [
      li(para(text('one')), { type: 'bulletList', content: [li(para(text('nested')))] }),
      li(para(text('two'))),
    ] })
    expect(jsonToMarkdown(d)).toBe('- one\n  - nested\n- two')
  })
  it('ordered numbering restarts per list', () => {
    const d = doc(
      { type: 'orderedList', content: [li(para(text('a'))), li(para(text('b')))] },
      { type: 'orderedList', content: [li(para(text('c')))] },
    )
    expect(jsonToMarkdown(d)).toBe('1. a\n2. b\n\n1. c')
  })
  it('blockquote prefixes every line, codeBlock is fenced, rules become ---', () => {
    const d = doc(
      { type: 'blockquote', content: [para(text('quoted'))] },
      { type: 'codeBlock', content: [text('const x = 1')] },
      { type: 'horizontalRule' },
      { type: 'pageBreak' },
    )
    expect(jsonToMarkdown(d)).toBe('> quoted\n\n```\nconst x = 1\n```\n\n---\n\n---')
  })
  it('table with a tableHeader row', () => {
    const d = doc({ type: 'table', content: [
      row(headerCell('Name'), headerCell('Age')),
      row(cell('Ada'), cell('36')),
    ] })
    expect(jsonToMarkdown(d)).toBe('| Name | Age |\n| --- | --- |\n| Ada | 36 |')
  })
  it('table with a plain first row still uses it as the header', () => {
    const d = doc({ type: 'table', content: [
      row(cell('A'), cell('B')),
      row(cell('1'), cell('2')),
    ] })
    expect(jsonToMarkdown(d)).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |')
  })
  it('image with http src embeds, data URL never embeds, alt brackets escaped', () => {
    const d = doc(
      { type: 'image', attrs: { src: 'https://example.com/pic.png', alt: 'A [fine] pic' } },
      { type: 'image', attrs: { src: 'data:image/png;base64,AAAA', alt: 'local' } },
    )
    expect(jsonToMarkdown(d)).toBe('![A \\[fine\\] pic](https://example.com/pic.png)\n\n![local]')
  })
  it('tocBlock: bold title, indented bullets, NO page numbers', () => {
    const d = doc({ type: 'tocBlock', attrs: { title: 'Contents', items: [
      { level: 1, text: 'Intro' },
      { level: 2, text: 'Details' },
      { level: 3, text: 'Deep' },
    ] } })
    const out = jsonToMarkdown(d)
    expect(out).toBe('**Contents**\n- Intro\n  - Details\n    - Deep')
    expect(out).not.toMatch(/\d+\s*$/m)
  })
  it('pipe and asterisk in plain text are escaped', () => {
    expect(jsonToMarkdown(doc(para(text('a | b * c'))))).toBe('a \\| b \\* c')
  })
  it('empty and null docs produce empty output', () => {
    expect(jsonToMarkdown(null)).toBe('')
    expect(jsonToMarkdown(undefined)).toBe('')
    expect(jsonToMarkdown({ type: 'doc', content: [] })).toBe('')
    expect(jsonToMarkdown({ type: 'doc' })).toBe('')
  })
  it('Persian (Dari) text is preserved verbatim with no direction markers', () => {
    const fa = 'سلام دنیا، این یک سند فارسی است'
    const out = jsonToMarkdown(doc(heading(1, text(fa)), para(text('متن نمونه'))))
    expect(out).toBe(`# ${fa}\n\nمتن نمونه`)
    expect(out).not.toMatch(/[\u200e\u200f\u202a-\u202e]/)
  })
  it('unknown blocks descend into children instead of dropping text', () => {
    const d = doc({ type: 'mysteryBox', content: [para(text('kept'))] })
    expect(jsonToMarkdown(d)).toBe('kept')
  })
})
