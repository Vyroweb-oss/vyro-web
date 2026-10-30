import { describe, it, expect } from 'vitest'
import { ExternalHyperlink, TextRun } from 'docx'
import { paragraphRuns } from './docx'

const para = (content: any[]) => ({ type: 'paragraph', content })
const linked = (text: string, href: string) => ({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] })
const plain = (text: string) => ({ type: 'text', text })

describe('M2-07 DOCX link preservation', () => {
  it('safe https link becomes an ExternalHyperlink, plain text stays a TextRun', () => {
    const out = paragraphRuns(para([linked('site', 'https://example.com'), plain(' after')]))
    expect(out[0]).toBeInstanceOf(ExternalHyperlink)
    expect(out[1]).toBeInstanceOf(TextRun)
  })
  it('mailto link is preserved as a hyperlink', () => {
    const out = paragraphRuns(para([linked('mail', 'mailto:a@example.com')]))
    expect(out[0]).toBeInstanceOf(ExternalHyperlink)
  })
  it('javascript: link degrades to plain text, text kept', () => {
    const out = paragraphRuns(para([linked('click', 'javascript:alert(1)')]))
    expect(out[0]).toBeInstanceOf(TextRun)
    expect(out[0]).not.toBeInstanceOf(ExternalHyperlink)
  })
  it('bold linked text keeps its run inside the hyperlink', () => {
    const out = paragraphRuns(para([{ type: 'text', text: 'b', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.com' } }] }]))
    expect(out[0]).toBeInstanceOf(ExternalHyperlink)
  })
})
