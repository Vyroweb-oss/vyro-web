// P2-4 code-splitting guards: heavy packages must reach the browser only
// through dynamic import(), never through a static import on a hot path.
// Source-level guards in the project's existing style (cf. gates.test.ts):
// they fail before a regression can ship, since the bundle itself is not
// asserted in unit tests.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { escapeHtml, isSafeLinkUrl, jsonToPlainText } from './docText'
import { escapeHtml as docxEscape, isSafeLinkUrl as docxSafe, jsonToPlainText as docxPlain } from './docx'

const editorSrc = readFileSync(resolve(process.cwd(), 'src/components/Editor.tsx'), 'utf8')
const appSrc = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')

describe('moved helpers behave identically from their new home', () => {
  it('escapeHtml escapes markup characters', () => {
    expect(escapeHtml('<a href="x">&y</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;y&lt;/a&gt;')
  })
  it('isSafeLinkUrl allows web/mail only', () => {
    expect(isSafeLinkUrl('https://example.com')).toBe(true)
    expect(isSafeLinkUrl('mailto:a@b.c')).toBe(true)
    expect(isSafeLinkUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeLinkUrl('')).toBe(false)
  })
  it('jsonToPlainText joins blocks with newlines and trims', () => {
    const doc = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
      { type: 'heading', content: [{ type: 'text', text: 'Title' }] },
    ] }
    expect(jsonToPlainText(doc)).toBe('Hello\nTitle')
  })
  it('docx.ts re-exports the exact same functions (no behaviour fork)', () => {
    expect(docxEscape).toBe(escapeHtml)
    expect(docxSafe).toBe(isSafeLinkUrl)
    expect(docxPlain).toBe(jsonToPlainText)
  })
})

describe('heavy paths are dynamically imported, not statically bundled', () => {
  it('Editor has no static import of docx.ts; DOCX export loads it lazily', () => {
    expect(editorSrc).not.toMatch(/from '\.\.\/lib\/docx'/)
    expect(editorSrc).toContain("await import('../lib/docx')")
    // Both gated call sites keep the exact shape gates.test.ts pins.
    expect(editorSrc.match(/gated\(\(\)=>exportDocx/g)?.length).toBe(2)
  })
  it('Editor DOCX failure surfaces the existing export-failed toast', () => {
    expect(editorSrc).toContain("t('exportFailed')")
  })
  it('App has no static import of supabase.ts; the client loads lazily when configured', () => {
    expect(appSrc).not.toContain("from './lib/supabase'")
    expect(appSrc).toContain("await import('./lib/supabase')")
    expect(appSrc).toContain("from './lib/supabaseEnv'")
  })
  it('mammoth stays dynamically imported on the DOCX import path', () => {
    expect(editorSrc).toContain("await import('mammoth')")
    expect(editorSrc).not.toMatch(/from 'mammoth'/)
  })
})
