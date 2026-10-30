import { describe, it, expect } from 'vitest'
import { collectLinks } from './links'
import { sanitizePastedHtml } from './paste'

const link = (text: string, href: string) => ({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] })
const para = (content: any[]) => ({ type: 'paragraph', content })
const doc = (content: any[]) => ({ type: 'doc', content })

describe('collectLinks', () => {
  it('lists links in document order with visible text + URL', () => {
    const d = doc([para([link('Vyro', 'https://example.com'), { type: 'text', text: ' and ' }, link('Mail', 'mailto:a@b.com')])])
    expect(collectLinks(d)).toEqual([
      { text: 'Vyro', href: 'https://example.com', valid: true },
      { text: 'Mail', href: 'mailto:a@b.com', valid: true },
    ])
  })
  it('handles Persian/Dari link text', () => {
    const d = doc([para([link('سند رسمی', 'https://example.com/fa')])])
    expect(collectLinks(d)).toEqual([{ text: 'سند رسمی', href: 'https://example.com/fa', valid: true }])
  })
  it('flags javascript: (and other dangerous protocols) as invalid, not safe', () => {
    const d = doc([para([link('click', 'javascript:alert(1)'), link('data', 'data:text/html,<b>x</b>')])])
    expect(collectLinks(d).map((l) => l.valid)).toEqual([false, false])
  })
  it('keeps empty-text links (e.g. image-only) instead of dropping them', () => {
    const d = doc([para([link('', 'https://example.com')])])
    expect(collectLinks(d)).toEqual([{ text: '', href: 'https://example.com', valid: true }])
  })
  it('ignores non-link marks and empty/malformed docs', () => {
    const d = doc([para([{ type: 'text', text: 'bold', marks: [{ type: 'bold' }] }])])
    expect(collectLinks(d)).toEqual([])
    expect(collectLinks(null)).toEqual([])
    expect(collectLinks({})).toEqual([])
  })
})

describe('links on paste (existing sanitizer contract)', () => {
  it('keeps safe links with their href', () => {
    const out = sanitizePastedHtml('<p><a href="https://example.com">site</a></p>')
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('site')
  })
  it('drops a javascript: link but keeps its visible text', () => {
    const out = sanitizePastedHtml('<p><a href="javascript:alert(1)">click me</a></p>')
    expect(out).not.toContain('javascript:')
    expect(out).toContain('click me')
  })
})

// NOTE: DOCX export is deliberately NOT asserted to keep links here —
// docx.ts builds TextRuns from text nodes and ignores marks, so links do
// not survive a DOCX export today (pre-existing limitation, see links.ts).
