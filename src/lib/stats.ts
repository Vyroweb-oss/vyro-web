// Document Statistics Pro (Mission 2, M2-05 = owner spec §10).
// Pure functions over stored TipTap JSON — no storage, no editor, no I/O.
// Statistics are derived live from the document; nothing is persisted, so
// the localStorage format is untouched and backward compatibility is trivial.
//
// DEFINITIONS (pinned by tests in stats.test.ts):
// - WORD: a maximal run of word characters, where a word character is a
//   Unicode letter, number, or combining mark, PLUS ZWNJ (U+200C) and ZWJ
//   (U+200D) as *internal* joiners. Consequences, all deliberate:
//   * ZWNJ-joined Persian words are ONE word: «می‌کنم» = 1, «کتاب‌های» = 1.
//   * Persian/Arabic-Indic digits are numbers (\p{N}), so digits attached
//     to a word never split it: «کتاب۱۲۳» = 1, «۱۲۳» = 1.
//   * A run must contain at least one letter or number, so punctuation
//     alone («!!!», «؟؟») is never a word, and a run of bare joiners is not.
//   * Hyphens, dashes, and zero-width SPACE (U+200B) are NOT word
//     characters, so they split words: "well-known" = 2 words, and a
//     U+200B break splits just like a space. ZWNJ/ZWJ at the very edge of
//     a run are ignored by the letter/number requirement, not counted.
//   * Mixed FA+EN text: each whitespace-separated token is a word, and
//     punctuation splits tokens the same way in both scripts.
// - TEXT: the text of every paragraph/heading/codeBlock node anywhere in
//   the doc (including inside list items, blockquotes, and table cells),
//   joined with "\n" between blocks — the same joining TipTap's getText
//   uses. Table cell text and heading text therefore DO count toward
//   words/chars (decided, not accidental): a table's words are document
//   words. Text is collected once per block node, never twice: a table
//   cell's paragraph contributes its text exactly once.
// - PARAGRAPHS: direct children of the doc node whose type is `paragraph`
//   or `heading`, PLUS every `listItem` node anywhere in the doc (nested
//   list items count too). Paragraphs inside table cells, blockquotes,
//   or list items are NOT counted again — they belong to the list item /
//   cell that contains them. An empty paragraph still counts as a block.
// - HEADINGS: every `heading` node anywhere, by its level attr (missing
//   or out-of-range levels clamp to 1..6; missing defaults to 1).
// - TABLES / IMAGES: every `table` / `image` node anywhere in the doc.
// - SENTENCES: the full text split on sentence terminators `.` `!` `?`
//   `؟` (FA question mark) and ellipsis (`…` or runs of `.`), where a
//   run of terminators is one boundary. `،` (FA comma) does NOT end a
//   sentence. A `.` between two digits is a decimal point, not a
//   boundary ("3.14" is one fragment). A fragment counts as a sentence
//   only if it contains at least one word, so trailing punctuation and
//   empty fragments never inflate the count.
// - ABBREVIATIONS (P2-20): a `.` is NOT a boundary when it belongs to an
//   abbreviation, decided inside isTerminator before `.` returns true:
//   (1) an internal dot with a letter on both sides (i.e./e.g./U.S.
//   internal dots, initials); (2) a token ending at the dot that is a
//   single initial (J.), a title (Dr., Mr., Mrs., Ms., Prof., Sr., Jr.,
//   St.), or an acronym of single letters joined by dots (U.S., U.K.,
//   U.S.A.); (3) a known abbreviation (e.g., i.e., etc., vs., approx.,
//   fig., eq., no., vol., pp., dept., est., misc., al.) is NOT a
//   boundary only when the next word starts with a lowercase letter or
//   a digit ("e.g. apples", "approx. 5 dollars"); when the next word
//   starts with an uppercase letter it IS a boundary (sentence-final
//   "etc. Then he left.").
// - REMAINING HEURISTIC LIMITS (documented, not hidden): a sentence-final
//   initial or acronym followed by another sentence still merges the two
//   ("He lives in the U.S. He works." counts as 1), and a capitalised
//   continuation after e.g./etc. counts as a new sentence ("etc. Apples
//   ..." counts the continuation separately). Fixing those needs real
//   language understanding, not a longer abbreviation list.
// - AVG SENTENCE LENGTH: words / sentences, 0 when there are no sentences.
// - READING TIME: ceil(words / 200) minutes, 0 when there are no words.
//   It is an ESTIMATE (reading speed varies); the UI label must say so.
// - ESTIMATED PAGES: words > 0 ? max(1, ceil(words / 250)) : 0. It is an
//   ESTIMATE (real pagination depends on font, margins, images); the UI
//   label must say so. A non-empty document is always at least 1 page.

export interface HeadingBreakdown {
  h1: number
  h2: number
  h3: number
  h4: number
  h5: number
  h6: number
}

export interface DocumentStats {
  words: number
  charsWithSpaces: number
  charsWithoutSpaces: number
  paragraphs: number
  headingsTotal: number
  headingsByLevel: HeadingBreakdown
  tables: number
  images: number
  sentences: number
  /** Words per sentence; 0 when there are no sentences. */
  avgSentenceLength: number
  /** Estimated minutes at 200 words/minute; 0 when there are no words. */
  readingTimeMinutes: number
  /** Estimated pages at 250 words/page; min 1 when words > 0, else 0. */
  estimatedPages: number
}

export interface SelectionStats {
  words: number
  charsWithSpaces: number
  charsWithoutSpaces: number
}

// Word runs: letters/numbers/marks plus internal joiners. Filtered below
// to runs containing at least one letter or number.
const WORD_RUN = /[\p{L}\p{N}\p{M}\u200C\u200D]+/gu
const HAS_LETTER_OR_NUMBER = /[\p{L}\p{N}]/u

/** Words in a plain string, under the WORD definition above. */
export function countWords(text: string): number {
  if (!text) return 0
  let n = 0
  for (const run of text.matchAll(WORD_RUN)) {
    if (HAS_LETTER_OR_NUMBER.test(run[0])) n++
  }
  return n
}

function hasWord(text: string): boolean {
  return countWords(text) > 0
}

// Titles whose trailing '.' is never a sentence boundary (P2-20).
const ABBREV_TITLES = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st'])
// Other known abbreviations: not a boundary only when the next word
// starts with a lowercase letter or a digit (continuation). Uppercase
// next word means the abbreviation ended the sentence.
const ABBREV_CONTINUATION_ONLY = new Set([
  'e.g', 'i.e', 'etc', 'vs', 'approx', 'fig', 'eq', 'no', 'vol', 'pp',
  'dept', 'est', 'misc', 'al',
])

/** Sentence count under the SENTENCES definition above. */
export function countSentences(text: string): number {
  if (!text || !hasWord(text)) return 0
  let count = 0
  let start = 0
  // First cased letter/digit word after a dot: true when it starts with
  // an uppercase letter. No next word, a digit, a lowercase letter, or
  // a caseless letter (e.g. Persian) all count as continuation (false).
  const nextWordStartsUppercase = (dotIndex: number): boolean => {
    let j = dotIndex + 1
    while (j < text.length && /[\s)\]}"'”»]/.test(text[j])) j++
    if (j >= text.length) return false
    const c = text[j]
    if (!/\p{L}/u.test(c)) return false
    return c !== c.toLowerCase() && c === c.toUpperCase()
  }
  const isTerminator = (i: number): boolean => {
    const ch = text[i]
    if (ch === '!' || ch === '?' || ch === '؟' || ch === '…') return true
    if (ch !== '.') return false
    // Decimal point: digit on both sides is not a sentence boundary.
    const prev = text[i - 1]
    const next = text[i + 1]
    if (prev !== undefined && next !== undefined && /\d/.test(prev) && /\d/.test(next)) return false
    // (1) Internal dot: a letter immediately before AND after.
    if (prev !== undefined && next !== undefined && /[A-Za-z]/.test(prev) && /[A-Za-z]/.test(next)) return false
    // Token ending at this dot, scanned back over letters and dots.
    let k = i - 1
    while (k >= 0 && /[A-Za-z.]/.test(text[k])) k--
    const token = text.slice(k + 1, i).replace(/\.+$/, '').toLowerCase()
    // (2) Single initial (J.) or title (Dr., Mr., ...): never a boundary.
    if (/^[a-z]$/.test(token)) return false
    if (ABBREV_TITLES.has(token)) return false
    // (3) Other known abbreviations: boundary only on an uppercase
    // next word (sentence-final case); lowercase/digit means continuation.
    if (ABBREV_CONTINUATION_ONLY.has(token)) return nextWordStartsUppercase(i)
    // (2, continued) Acronym of single letters joined by dots (U.S., U.K.).
    const parts = token.split('.')
    if (parts.length >= 2 && parts.every((p) => /^[a-z]$/.test(p))) return false
    return true
  }
  for (let i = 0; i < text.length; i++) {
    if (!isTerminator(i)) continue
    // Consume a run of terminators (e.g. "...", "?!") as one boundary.
    let j = i
    while (j + 1 < text.length && isTerminator(j + 1)) j++
    if (hasWord(text.slice(start, i))) count++
    start = j + 1
    i = j
  }
  // Trailing fragment without a terminator is a sentence if it has a word.
  if (hasWord(text.slice(start))) count++
  return count
}

/** Inline text of a node (text nodes joined, blocks not descended into
 *  here — the caller walks blocks separately so nothing is double-counted). */
function nodeText(node: any): string {
  if (!node || typeof node !== 'object') return ''
  if (node.type === 'text') return node.text || ''
  if (Array.isArray(node.content)) return node.content.map(nodeText).join('')
  return ''
}

/**
 * Block texts of the doc: one string per paragraph / heading / codeBlock
 * node anywhere (table cells and list items included). Other block nodes
 * (blockquote, listItem, tableCell, tableRow, table, lists, doc) are
 * transparent containers: their children are walked, never their own text.
 */
function blockTexts(node: any, out: string[]): void {
  if (!node || typeof node !== 'object') return
  if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'codeBlock') {
    out.push(nodeText(node))
    return
  }
  if (node.type === 'text') {
    // A bare text node outside any block (unusual, but possible in a
    // hand-built doc): count it as its own block rather than dropping it.
    out.push(node.text || '')
    return
  }
  if (Array.isArray(node.content)) node.content.forEach((child: any) => blockTexts(child, out))
}

/** Joined block text of a doc (one string per block, "\n"-joined). */
function documentBlockText(docJson: any): string {
  const blocks: string[] = []
  if (docJson && typeof docJson === 'object') blockTexts(docJson, blocks)
  return blocks.join('\n')
}

// READABILITY (P2-7, Word-gap statistics; estimate, English only):
// - Latin words only: runs of [A-Za-z] plus common accented Latin letters
//   (Latin-1 Supplement + Latin Extended-A). Persian/Arabic-script words
//   are never syllable-counted — no fake Dari syllable counts.
// - Syllables: vowel groups [aeiouy]+ per word (case-insensitive), minus
//   1 for a silent trailing 'e' when the word has >1 group, minimum 1.
//   A known heuristic limit: it undercounts words like "syllable" (2
//   counted vs 3 spoken), and abbreviations over-count like sentences do.
// - Returns null when there are fewer than 10 Latin words or 0 sentences
//   (sentence count uses countSentences over the same full text).
// - Flesch ease is NOT clamped: very simple text may exceed 100, and the
//   UI label says the scores are estimates, English only.
export interface Readability {
  latinWords: number
  syllables: number
  fleschEase: number
  fleschKincaidGrade: number
}

const LATIN_WORD = /[A-Za-z\u00C0-\u024F]+/g

/** Syllable estimate for one Latin word under the heuristic above. */
export function countSyllables(word: string): number {
  const groups = word.toLowerCase().match(/[aeiouy]+/g)
  let n = groups ? groups.length : 0
  if (n > 1 && /e$/i.test(word)) n--
  return Math.max(1, n)
}

const round1 = (v: number): number => {
  const r = Math.round(v * 10) / 10
  return r === 0 ? 0 : r
}

/** Readability estimate for a TipTap doc JSON, or null when not computable. */
export function computeReadability(docJson: any): Readability | null {
  const fullText = documentBlockText(docJson)
  const sentences = countSentences(fullText)
  if (sentences === 0) return null
  const latinWordsList = fullText.match(LATIN_WORD) ?? []
  if (latinWordsList.length < 10) return null
  const latinWords = latinWordsList.length
  const syllables = latinWordsList.reduce((sum, w) => sum + countSyllables(w), 0)
  const wordsPerSentence = latinWords / sentences
  const syllablesPerWord = syllables / latinWords
  return {
    latinWords,
    syllables,
    fleschEase: round1(206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord),
    fleschKincaidGrade: round1(0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59),
  }
}

function emptyBreakdown(): HeadingBreakdown {
  return { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 }
}

/** Full document statistics from stored TipTap JSON. Null/odd input = empty doc. */
export function computeDocumentStats(docJson: any): DocumentStats {
  const fullText = documentBlockText(docJson)
  const words = countWords(fullText)
  const sentences = countSentences(fullText)

  // Structural walk: paragraph count, headings, tables, images.
  let topBlocks = 0
  let listItems = 0
  let tables = 0
  let images = 0
  const byLevel = emptyBreakdown()
  const top = Array.isArray(docJson?.content) ? docJson.content : []
  for (const child of top) {
    if (child && (child.type === 'paragraph' || child.type === 'heading')) topBlocks++
  }
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'listItem') listItems++
    else if (node.type === 'table') tables++
    else if (node.type === 'image') images++
    else if (node.type === 'heading') {
      const raw = node.attrs?.level
      const level = typeof raw === 'number' ? Math.min(6, Math.max(1, Math.round(raw))) : 1
      byLevel[`h${level}` as keyof HeadingBreakdown]++
    }
    if (Array.isArray(node.content)) node.content.forEach(walk)
  }
  walk(docJson)
  const headingsTotal = Object.values(byLevel).reduce((a, b) => a + b, 0)

  return {
    words,
    charsWithSpaces: fullText.length,
    charsWithoutSpaces: fullText.replace(/\s/g, '').length,
    paragraphs: topBlocks + listItems,
    headingsTotal,
    headingsByLevel: byLevel,
    tables,
    images,
    sentences,
    avgSentenceLength: sentences > 0 ? words / sentences : 0,
    readingTimeMinutes: words > 0 ? Math.ceil(words / 200) : 0,
    estimatedPages: words > 0 ? Math.max(1, Math.ceil(words / 250)) : 0,
  }
}

/**
 * Statistics for a selected string. Returns null for an empty or
 * whitespace-only selection — the UI hides the Selection column then.
 * A non-empty selection always carries the same three counters as the
 * document stats (words + both char counts).
 */
export function computeSelectionStats(selectedText: string | null | undefined): SelectionStats | null {
  if (!selectedText || selectedText.trim() === '') return null
  return {
    words: countWords(selectedText),
    charsWithSpaces: selectedText.length,
    charsWithoutSpaces: selectedText.replace(/\s/g, '').length,
  }
}
