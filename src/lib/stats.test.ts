import { describe, it, expect } from 'vitest'
import { computeDocumentStats, computeSelectionStats, countWords, countSentences } from './stats'
import { STRINGS } from './i18n'

const p = (text: string) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })
const h = (level: number, text: string) => ({ type: 'heading', attrs: { level }, content: text ? [{ type: 'text', text }] : [] })
const doc = (...content: any[]) => ({ type: 'doc', content })
const cell = (text: string) => ({ type: 'tableCell', content: [p(text)] })
const table = (...cells: any[]) => ({ type: 'table', content: [{ type: 'tableRow', content: cells }] })
const listItem = (...blocks: any[]) => ({ type: 'listItem', content: blocks })
const bulletList = (...items: any[]) => ({ type: 'bulletList', content: items })

describe('empty / degenerate documents', () => {
  it('empty doc and null input are all zeros (incl. 0 estimated pages)', () => {
    for (const input of [doc(), { type: 'doc', content: [] }, null, undefined, {} as any]) {
      const s = computeDocumentStats(input)
      expect(s).toEqual({
        words: 0, charsWithSpaces: 0, charsWithoutSpaces: 0, paragraphs: 0,
        headingsTotal: 0, headingsByLevel: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
        tables: 0, images: 0, sentences: 0, avgSentenceLength: 0,
        readingTimeMinutes: 0, estimatedPages: 0,
      })
    }
  })
  it('an empty paragraph still counts as one paragraph block, with no words', () => {
    const s = computeDocumentStats(doc(p('')))
    expect(s.paragraphs).toBe(1)
    expect(s.words).toBe(0)
    expect(s.estimatedPages).toBe(0)
  })
  it('punctuation alone is not words and not sentences', () => {
    const s = computeDocumentStats(doc(p('!!! ??? ؟؟ …')))
    expect(s.words).toBe(0)
    expect(s.sentences).toBe(0)
    expect(s.paragraphs).toBe(1)
  })
})

describe('English document', () => {
  it('counts words, chars, paragraphs, headings, sentences, avg, reading time', () => {
    const s = computeDocumentStats(doc(h(1, 'Title'), p('Hello world. This is a test.')))
    expect(s.words).toBe(7) // Title + 6 body words; heading text counts
    expect(s.charsWithSpaces).toBe(34) // "Title\nHello world. This is a test."
    expect(s.charsWithoutSpaces).toBe(28)
    expect(s.paragraphs).toBe(2) // heading block + paragraph block
    expect(s.headingsTotal).toBe(1)
    expect(s.headingsByLevel.h1).toBe(1)
    expect(s.sentences).toBe(2)
    expect(s.avgSentenceLength).toBeCloseTo(3.5)
    expect(s.readingTimeMinutes).toBe(1) // ceil(7/200)
    expect(s.estimatedPages).toBe(1)
  })
  it('hyphen splits words; ellipsis and ?! runs are single boundaries', () => {
    expect(countWords('well-known test')).toBe(3)
    expect(countSentences('One... Two?! Three.')).toBe(3)
    expect(countSentences('Hello world')).toBe(1) // trailing fragment counts
    expect(countSentences('Price 3.14 dollars.')).toBe(1) // decimal point is not a boundary
  })
})

describe('Persian / Dari word counting', () => {
  it('ZWNJ-joined tokens are ONE word each', () => {
    expect(countWords('می‌کنم')).toBe(1)
    expect(countWords('کتاب‌های')).toBe(1)
    expect(countWords('من می‌کنم کتاب‌های را خواندم')).toBe(5)
    const s = computeDocumentStats(doc(p('من می‌کنم کتاب‌های را خواندم')))
    expect(s.words).toBe(5)
    expect(s.sentences).toBe(1)
    expect(s.avgSentenceLength).toBe(5)
  })
  it('Persian/Arabic-Indic digits attached to words do not split them', () => {
    expect(countWords('کتاب۱۲۳ و ۴۵۶ عدد')).toBe(4)
    expect(countWords('سال ۱۴۰۳ است')).toBe(3)
    expect(countWords('۱۲۳')).toBe(1)
  })
  it('zero-width space splits, bare joiners are not words', () => {
    expect(countWords('سلام\u200Bدنیا')).toBe(2)
    expect(countWords('\u200C \u200D')).toBe(0)
  })
  it('mixed FA+EN: each whitespace-separated token is a word', () => {
    expect(countWords('Hello سلام دنیا world')).toBe(4)
    const s = computeDocumentStats(doc(p('Hello سلام'), p('world دنیا')))
    expect(s.words).toBe(4)
  })
  it('FA sentence punctuation: ؟ ends a sentence, ، does not', () => {
    expect(countSentences('سلام دنیا؟ حال شما چطور است. خوبم!')).toBe(3)
    expect(countSentences('سلام، دنیا')).toBe(1)
    const s = computeDocumentStats(doc(p('سلام دنیا؟ حال شما چطور است. خوبم!')))
    expect(s.words).toBe(7)
    expect(s.sentences).toBe(3)
    expect(s.avgSentenceLength).toBeCloseTo(7 / 3)
  })
})

describe('structure: headings, lists, tables, images', () => {
  it('headings breakdown per level; missing level defaults to h1', () => {
    const s = computeDocumentStats(doc(
      h(1, 'A'), h(2, 'B'), h(2, 'C'), h(3, 'D'),
      { type: 'heading', content: [{ type: 'text', text: 'NoLevel' }] },
      h(9, 'Clamped'),
    ))
    expect(s.headingsTotal).toBe(6)
    expect(s.headingsByLevel).toEqual({ h1: 2, h2: 2, h3: 1, h4: 0, h5: 0, h6: 1 })
    expect(s.paragraphs).toBe(6) // every heading is a top-level block
  })
  it('list items count as paragraphs; nested items count too', () => {
    const s = computeDocumentStats(doc(
      p('intro'),
      bulletList(listItem(p('one')), listItem(p('two'), bulletList(listItem(p('nested'))))),
    ))
    expect(s.paragraphs).toBe(4) // intro + one + two + nested
    expect(s.words).toBe(4)
  })
  it('table cell text counts toward words exactly once; tables counted', () => {
    const s = computeDocumentStats(doc(p('body text'), table(cell('cell one'), cell('cell two')), { type: 'image', attrs: { src: 'x.png' } }))
    expect(s.words).toBe(6) // body text (2) + cell one (2) + cell two (2), none doubled
    expect(s.tables).toBe(1)
    expect(s.images).toBe(1)
    expect(s.paragraphs).toBe(1) // only the top-level paragraph; cell paragraphs are not re-counted
  })
  it('blockquote paragraphs are not double-counted as top-level paragraphs, but their words count', () => {
    const s = computeDocumentStats(doc(p('top'), { type: 'blockquote', content: [p('quoted words')] }))
    expect(s.paragraphs).toBe(1)
    expect(s.words).toBe(3)
  })
  it('multiple images and tables anywhere are counted', () => {
    const s = computeDocumentStats(doc(
      { type: 'image', attrs: { src: 'a.png' } },
      table(cell('x')),
      p('text'),
      { type: 'image', attrs: { src: 'b.png' } },
    ))
    expect(s.tables).toBe(1)
    expect(s.images).toBe(2)
  })
})

describe('reading time and estimated pages rounding', () => {
  const wordsDoc = (n: number) => doc(p(Array(n).fill('word').join(' ')))
  it('reading time: 0 words -> 0, 200 -> 1, 201 -> 2', () => {
    expect(computeDocumentStats(wordsDoc(0)).readingTimeMinutes).toBe(0)
    expect(computeDocumentStats(wordsDoc(200)).readingTimeMinutes).toBe(1)
    expect(computeDocumentStats(wordsDoc(201)).readingTimeMinutes).toBe(2)
  })
  it('estimated pages: 0 -> 0, 1..250 -> 1, 251 -> 2, 500 -> 2', () => {
    expect(computeDocumentStats(wordsDoc(0)).estimatedPages).toBe(0)
    expect(computeDocumentStats(wordsDoc(1)).estimatedPages).toBe(1)
    expect(computeDocumentStats(wordsDoc(250)).estimatedPages).toBe(1)
    expect(computeDocumentStats(wordsDoc(251)).estimatedPages).toBe(2)
    expect(computeDocumentStats(wordsDoc(500)).estimatedPages).toBe(2)
  })
  it('reading-time UI labels carry the estimate word in both languages', () => {
    expect(STRINGS.en.statsReadingTimeEstimate).toMatch(/estimate/i)
    expect(STRINGS.fa.statsReadingTimeEstimate).toContain('تخمینی')
  })
  it('Tier-1 S2: the panel page label is the plain real-count label, not an estimate', () => {
    expect(STRINGS.en.statsPages).toBe('Pages')
    expect(STRINGS.fa.statsPages).toBe('صفحه‌ها')
    expect((STRINGS.en as any).statsEstimatedPages).toBeUndefined()
    expect((STRINGS.fa as any).statsEstimatedPages).toBeUndefined()
  })
})

describe('selection stats', () => {
  it('empty / whitespace-only / null selection is null (UI hides the column)', () => {
    expect(computeSelectionStats('')).toBeNull()
    expect(computeSelectionStats('   \n ')).toBeNull()
    expect(computeSelectionStats(null)).toBeNull()
    expect(computeSelectionStats(undefined)).toBeNull()
  })
  it('a word subset: English and FA selections', () => {
    expect(computeSelectionStats('hello world foo')).toEqual({ words: 3, charsWithSpaces: 15, charsWithoutSpaces: 13 })
    expect(computeSelectionStats('می‌کنم')).toEqual({ words: 1, charsWithSpaces: 6, charsWithoutSpaces: 6 })
    expect(computeSelectionStats('سلام دنیا')).toEqual({ words: 2, charsWithSpaces: 9, charsWithoutSpaces: 8 })
  })
})
