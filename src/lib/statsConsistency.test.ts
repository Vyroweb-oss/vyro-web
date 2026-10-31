// Tier-1 S2: counter consistency + real page count.
// The Review ribbon, the status bar and the Statistics panel must all read
// the SAME authoritative stats.ts computation, and the panel's page row
// must show the editor's real paginated page count — never the
// words-per-page heuristic. These guards pin the wiring (the counters live
// in JSX), plus the Dari tokenization case where the old naive ribbon
// counter demonstrably diverged.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { computeDocumentStats } from './stats'

const editorSrc = readFileSync(resolve(process.cwd(), 'src/components/Editor.tsx'), 'utf8')
const panelSrc = readFileSync(resolve(process.cwd(), 'src/components/StatsPanel.tsx'), 'utf8')

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const docOf = (...texts: string[]) => ({ type: 'doc', content: texts.map(para) })

describe('Tier-1 S2: one authoritative counter', () => {
  it('the Review ribbon reads statusStats (stats.ts), not a naive counter', () => {
    expect(editorSrc).toContain('{statusStats.words}')
    expect(editorSrc).toContain('{statusStats.charsWithSpaces}')
    expect(editorSrc).toContain('{statusStats.paragraphs}')
    // the old divergent computations are gone
    expect(editorSrc).not.toMatch(/split\(\/\\s\+\/\)/)
    expect(editorSrc).not.toContain('characterCount?.characters')
    expect(editorSrc).not.toContain('paragraphsApprox')
  })
  it('Dari/ZWNJ text: the authoritative count differs from naive whitespace splitting', () => {
    // "سلام—دنیا" is ONE whitespace token but TWO words for the tokenizer;
    // the old ribbon would have shown 2 words for this doc, stats.ts says 3.
    const s = computeDocumentStats(docOf('سلام—دنیا', 'می‌شود'))
    expect(s.words).toBe(3)
    expect(s.paragraphs).toBe(2)
    const naive = 'سلام—دنیا\nمی‌شود'.trim().split(/\s+/).length
    expect(naive).toBe(2)
    expect(s.words).not.toBe(naive)
  })
  it('empty document counts are all zero', () => {
    const s = computeDocumentStats({ type: 'doc', content: [{ type: 'paragraph' }] })
    expect(s.words).toBe(0)
    expect(s.charsWithSpaces).toBe(0)
    expect(s.paragraphs).toBe(1)
  })
})

describe('Tier-1 S2: real page count in the Statistics panel', () => {
  it('StatsPanel takes a pages prop and renders the statsPages row from it', () => {
    expect(panelSrc).toContain('pages: number')
    expect(panelSrc).toContain("['statsPages', String(pages)]")
    expect(panelSrc).not.toContain('statsEstimatedPages')
    expect(panelSrc).not.toContain('estimatedPages')
  })
  it('the Editor passes its pagination state (pageCount) into the panel', () => {
    expect(editorSrc).toContain('pages={pageCount}')
    // pageCount still comes only from the measure pass result
    expect(editorSrc).toContain('setPageCount(p=>p===res.pageCount?p:res.pageCount)')
  })
})
