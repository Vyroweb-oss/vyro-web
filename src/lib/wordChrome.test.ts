import { describe, it, expect } from 'vitest'
import { clampZoom, zoomStep, docLanguageLabel, documentLanguageLabel, documentDirectionLabel, estimatedPagesFromWords, activeParagraphStyle, countNoun, type ParagraphStyleState } from './wordChrome'

describe('clampZoom', () => {
  it('keeps in-range values and clamps both ends', () => {
    expect(clampZoom(100)).toBe(100)
    expect(clampZoom(50)).toBe(50)
    expect(clampZoom(200)).toBe(200)
    expect(clampZoom(49)).toBe(50)
    expect(clampZoom(201)).toBe(200)
    expect(clampZoom(-10)).toBe(50)
  })
  it('resets non-finite input to 100', () => {
    expect(clampZoom(NaN)).toBe(100)
    expect(clampZoom(Infinity)).toBe(100)
  })
})

describe('zoomStep', () => {
  it('steps and clamps at the ends', () => {
    expect(zoomStep(100, 10)).toBe(110)
    expect(zoomStep(100, -10)).toBe(90)
    expect(zoomStep(195, 10)).toBe(200)
    expect(zoomStep(55, -10)).toBe(50)
  })
})

describe('docLanguageLabel', () => {
  it('labels rtl as Dari/Persian and anything else as English', () => {
    expect(docLanguageLabel('rtl')).toBe('RTL · دری/فارسی')
    expect(docLanguageLabel('ltr')).toBe('LTR · English')
    expect(docLanguageLabel('')).toBe('LTR · English')
  })
})

describe('PC4 split status-bar labels', () => {
  it('language item is Dari/Persian for rtl and English otherwise', () => {
    expect(documentLanguageLabel('rtl')).toBe('دری/فارسی')
    expect(documentLanguageLabel('ltr')).toBe('English')
    expect(documentLanguageLabel('')).toBe('English')
  })
  it('direction item is RTL for rtl and LTR otherwise', () => {
    expect(documentDirectionLabel('rtl')).toBe('RTL')
    expect(documentDirectionLabel('ltr')).toBe('LTR')
    expect(documentDirectionLabel('')).toBe('LTR')
  })
  it('split items recombine exactly to the legacy merged label', () => {
    for (const dir of ['rtl', 'ltr', '']) {
      expect(`${documentDirectionLabel(dir)} · ${documentLanguageLabel(dir)}`).toBe(docLanguageLabel(dir))
    }
  })
  it('the footer page figure stays an estimate, never a true page count: no true-page-count helper exists', () => {
    // The editor is a single continuous growing page, so "Page X of Y" is
    // not computable; the footer data source is the 250-words/page estimate.
    expect(estimatedPagesFromWords(250)).toBe(1)
    expect(estimatedPagesFromWords(251)).toBe(2)
    expect(estimatedPagesFromWords(0)).toBe(0)
  })
})

describe('estimatedPagesFromWords', () => {
  it('mirrors the stats.ts estimate: 0 pages when empty, 1 page minimum, 250 words/page', () => {
    expect(estimatedPagesFromWords(0)).toBe(0)
    expect(estimatedPagesFromWords(-5)).toBe(0)
    expect(estimatedPagesFromWords(1)).toBe(1)
    expect(estimatedPagesFromWords(250)).toBe(1)
    expect(estimatedPagesFromWords(251)).toBe(2)
    expect(estimatedPagesFromWords(500)).toBe(2)
  })
})

const base: ParagraphStyleState = { isHeading1: false, isHeading2: false, isHeading3: false, isParagraph: true, isBold: false, fontSizePx: null }

describe('activeParagraphStyle', () => {
  it('headings win over paragraph formatting', () => {
    expect(activeParagraphStyle({ ...base, isHeading1: true })).toBe('heading1')
    expect(activeParagraphStyle({ ...base, isHeading2: true })).toBe('heading2')
    expect(activeParagraphStyle({ ...base, isHeading3: true })).toBe('heading3')
  })
  it('title is exactly a bold 28px paragraph — bold alone or 28px alone is Normal', () => {
    expect(activeParagraphStyle({ ...base, isBold: true, fontSizePx: 28 })).toBe('title')
    expect(activeParagraphStyle({ ...base, isBold: true, fontSizePx: 16 })).toBe('normal')
    expect(activeParagraphStyle({ ...base, isBold: false, fontSizePx: 28 })).toBe('normal')
    expect(activeParagraphStyle(base)).toBe('normal')
  })
  it('returns null when neither a heading nor a paragraph is active', () => {
    expect(activeParagraphStyle({ ...base, isParagraph: false })).toBeNull()
  })
})

describe('countNoun', () => {
  it('returns the singular only at exactly 1', () => {
    expect(countNoun(1, 'word', 'words')).toBe('word')
    expect(countNoun(1, 'char', 'chars')).toBe('char')
    expect(countNoun(1, 'character', 'characters')).toBe('character')
    expect(countNoun(1, 'page', 'pages')).toBe('page')
    expect(countNoun(1, 'paragraph', 'Paragraphs')).toBe('paragraph')
  })
  it('returns the plural at 0, 2 and 100', () => {
    for (const n of [0, 2, 100]) {
      expect(countNoun(n, 'word', 'words')).toBe('words')
      expect(countNoun(n, 'page', 'pages')).toBe('pages')
    }
  })
  it('returns the plural for negative and non-finite counts', () => {
    expect(countNoun(-1, 'word', 'words')).toBe('words')
    expect(countNoun(NaN, 'word', 'words')).toBe('words')
    expect(countNoun(Infinity, 'word', 'words')).toBe('words')
  })
})
