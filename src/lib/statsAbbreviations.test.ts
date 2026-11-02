// P2-20: sentence-count abbreviation handling in countSentences.
// Abbreviation dots must not split sentences; sentence-final known
// abbreviations followed by an uppercase word still end the sentence.
import { describe, expect, it } from 'vitest'
import { countSentences } from './stats'

describe('abbreviations do not split sentences', () => {
  it('e.g. with a lowercase continuation is one sentence', () => {
    expect(countSentences('He likes fruit, e.g. apples and oranges. He also likes pears.')).toBe(2)
  })
  it('titles Dr./Mr./Mrs. do not split', () => {
    expect(countSentences('Dr. Smith arrived. He left.')).toBe(2)
    expect(countSentences('Mr. Jones and Mrs. Smith met. They talked.')).toBe(2)
  })
  it('acronyms U.S. do not split', () => {
    expect(countSentences('The U.S. Army is large. It is strong.')).toBe(2)
  })
  it('initials J. R. R. do not split', () => {
    expect(countSentences('J. R. R. Tolkien wrote books. He was famous.')).toBe(2)
  })
  it('sentence-final etc. before an uppercase word ends the sentence', () => {
    expect(countSentences('He brought pens, paper, etc. Then he left.')).toBe(2)
  })
  it('etc. before a lowercase continuation does not end the sentence', () => {
    expect(countSentences('He brought pens, paper, etc. and more pens.')).toBe(1)
  })
  it('approx. before a digit does not end the sentence', () => {
    expect(countSentences('The price is approx. 5 dollars. It is cheap.')).toBe(2)
  })
})

describe('abbreviation regression guards', () => {
  it('decimal points still do not split', () => {
    expect(countSentences('Price 3.14 dollars.')).toBe(1)
  })
  it('ellipsis and ?! runs are still single boundaries', () => {
    expect(countSentences('One... Two?! Three.')).toBe(3)
  })
  it('FA punctuation unchanged: ؟ ends, ، does not', () => {
    expect(countSentences('سلام دنیا؟ حال شما چطور است. خوبم!')).toBe(3)
  })
})
