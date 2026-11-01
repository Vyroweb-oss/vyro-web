import { describe, it, expect } from 'vitest'
import { computeReadability, countSyllables } from './stats'

const p = (text: string) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })
const h = (level: number, text: string) => ({ type: 'heading', attrs: { level }, content: text ? [{ type: 'text', text }] : [] })
const doc = (...content: any[]) => ({ type: 'doc', content })
const cell = (text: string) => ({ type: 'tableCell', content: [p(text)] })
const table = (...cells: any[]) => ({ type: 'table', content: [{ type: 'tableRow', content: cells }] })

// Known sentence: 11 Latin words, 11 syllables, 1 sentence.
// ease = 206.835 - 1.015*11 - 84.6*1 = 111.07 -> 111.1 (NOT clamped: >100)
// grade = 0.39*11 + 11.8*1 - 15.59 = 0.5
const SIMPLE = 'The cat sat on the mat and the dog ran fast.'

describe('syllable heuristic (Latin words only)', () => {
  it('cake = 1 (silent trailing e removed)', () => {
    expect(countSyllables('cake')).toBe(1)
  })
  it('beautiful = 3', () => {
    expect(countSyllables('beautiful')).toBe(3)
  })
  it('cat = 1', () => {
    expect(countSyllables('cat')).toBe(1)
  })
  it('reading = 2', () => {
    expect(countSyllables('reading')).toBe(2)
  })
  it('syllable handling: trailing-e heuristic undercounts "syllable" to 2 (known limit, documented in stats.ts)', () => {
    expect(countSyllables('syllable')).toBe(2)
  })
  it('a word with no vowel group still counts at least 1', () => {
    expect(countSyllables('nth')).toBe(1)
  })
})

describe('computeReadability', () => {
  it('simple known sentence: ease within 0.1 of the formula value', () => {
    const r = computeReadability(doc(p(SIMPLE)))
    expect(r).not.toBeNull()
    expect(r!.latinWords).toBe(11)
    expect(r!.syllables).toBe(11)
    expect(r!.fleschEase).toBeCloseTo(111.1, 1)
  })
  it('simple known sentence: grade within 0.1 of the formula value', () => {
    const r = computeReadability(doc(p(SIMPLE)))
    expect(r).not.toBeNull()
    expect(r!.fleschKincaidGrade).toBeCloseTo(0.5, 1)
  })
  it('Dari-only doc returns null (no Latin words, no faked syllables)', () => {
    expect(computeReadability(doc(p('این یک متن فارسی است که برای آزمایش نوشته شده است و ادامه دارد')))).toBeNull()
  })
  it('empty doc and null input return null', () => {
    expect(computeReadability(doc())).toBeNull()
    expect(computeReadability(null)).toBeNull()
    expect(computeReadability(undefined)).toBeNull()
  })
  it('fewer than 10 Latin words returns null', () => {
    expect(computeReadability(doc(p('The cat sat on the mat and the dog.')))).toBeNull()
  })
  it('mixed FA+EN doc counts only Latin words', () => {
    const r = computeReadability(doc(p('این یک متن فارسی است'), p(SIMPLE)))
    expect(r).not.toBeNull()
    expect(r!.latinWords).toBe(11)
    expect(r!.syllables).toBe(11)
  })
  it('table-cell text is included, same as document stats', () => {
    const r = computeReadability(doc(table(cell(SIMPLE))))
    expect(r).not.toBeNull()
    expect(r!.latinWords).toBe(11)
    expect(r!.fleschEase).toBeCloseTo(111.1, 1)
  })
  it('heading text is included', () => {
    const r = computeReadability(doc(h(1, SIMPLE)))
    expect(r).not.toBeNull()
    expect(r!.latinWords).toBe(11)
    expect(r!.fleschEase).toBeCloseTo(111.1, 1)
  })
  it('punctuation-only doc returns null', () => {
    expect(computeReadability(doc(p('!!! ??? …')))).toBeNull()
  })
  it('grade rises for longer, harder sentences', () => {
    const easy = computeReadability(doc(p(SIMPLE)))
    const hard = computeReadability(doc(p('The extraordinarily complicated university professor explained incomprehensible philosophical terminology repeatedly during the presentation.')))
    expect(easy).not.toBeNull()
    expect(hard).not.toBeNull()
    expect(hard!.fleschKincaidGrade).toBeGreaterThan(easy!.fleschKincaidGrade)
    expect(hard!.fleschEase).toBeLessThan(easy!.fleschEase)
  })
})
