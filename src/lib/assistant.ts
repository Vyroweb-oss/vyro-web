// Vyro Assistant (دستیار وایرو) — the app's OWN built-in assistant.
// Owner order 2026-11-03: the assistant must be Vyro's own, NOT another
// AI service — no external AI, no API, no network, nothing leaves the
// app. It understands typed commands (Persian/Dari + English) and
// EXECUTES them inside the document with the editor's own features:
// tables, headings, lists, templates, page breaks, cleanup and
// extractive summaries. It honestly cannot free-write essays; when a
// user asks for one it offers the essay template instead of faking text.
//
// This module is pure: parsing + text algorithms + template builders.
// The panel (IntelligencePanel) applies the returned actions to the
// editor. Nothing here fetches, stores or uploads anything.

export type AssistantTemplateKind = 'cover' | 'letter' | 'cv' | 'essay'

export type AssistantAction =
  | { kind: 'insert-table'; rows: number; cols: number }
  | { kind: 'insert-heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'insert-list'; ordered: boolean; items: string[] }
  | { kind: 'insert-text'; text: string }
  | { kind: 'insert-template'; template: AssistantTemplateKind; topic?: string }
  | { kind: 'insert-page-break' }
  | { kind: 'insert-date' }
  | { kind: 'research'; topic: string; paragraphs: number; pages?: number; insert: boolean }
  | { kind: 'answer'; question: string }
  | { kind: 'answer-local'; lines: string[] }
  | { kind: 'selection-heading'; level: 1 | 2 | 3 }
  | { kind: 'selection-bold' }
  | { kind: 'selection-cleanup' }
  | { kind: 'selection-summarize' }
  | { kind: 'document-summarize' }
  | { kind: 'document-keypoints' }
  | { kind: 'document-stats' }
  | { kind: 'help' }
  | { kind: 'unknown'; input: string }

// ---- Normalization -------------------------------------------------------

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹'
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'

export function normalizeDigits(s: string): string {
  return s.replace(/[۰-۹]/g, (c) => String(FA_DIGITS.indexOf(c)))
          .replace(/[٠-٩]/g, (c) => String(AR_DIGITS.indexOf(c)))
}

/** Lowercase, Latin digits, Persian letter unification, single spaces. */
export function normalizeCommand(raw: string): string {
  return normalizeDigits(raw)
    .replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/ة/g, 'ه').replace(/ؤ/g, 'و')
    .replace(/[‌]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

const RESEARCH_STOP = new Set([
  'در', 'از', 'اینترنت', 'وب', 'آنلاین', 'جستجو', 'سرچ', 'تحقیق', 'بگرد', 'بنویس', 'بساز',
  'درباره', 'باره', 'مقاله', 'انشا', 'متن', 'یک', 'و', 'را', 'کن', 'پاراگراف', 'سایت',
  'صفحه', 'صفحات', 'page', 'pages', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه',
  'ده', 'پانزده', 'بیست', 'سی', 'تایپ', 'درج', 'نشان', 'نمایش', 'سند', 'فقط', 'بده',
  'نکن', 'ننویس', 'نکنید',
  'essay', 'write', 'search', 'research', 'internet', 'web', 'online', 'the', 'for',
  'about', 'make', 'an', 'a', 'article', 'text', 'find', 'paragraph', 'paragraphs', 'and',
])

const cleanToken = (w: string) => w.replace(/[،,؛;:«»"“”؟?!.\u200C]/g, '')

/** The topic left after the command words are removed. */
export function extractResearchTopic(normalized: string): string {
  return normalized
    .split(' ')
    .map(cleanToken)
    .filter((w) => w && !RESEARCH_STOP.has(w) && !/^\d+$/.test(w))
    .join(' ')
    .trim()
}

const QUESTION_STOP = new Set([
  'چیست', 'چه', 'چرا', 'چگونه', 'چطور', 'کی', 'کجا', 'کجاست', 'کدام', 'آیا', 'است', 'هست',
  'می', 'شود', 'کیست', 'چی', 'بگو', 'بده', 'لطفا', 'توضیح',
  'what', 'why', 'how', 'when', 'where', 'who', 'which', 'is', 'are', 'can', 'does', 'do',
  'the', 'a', 'an', 'of', 'in', 'on', 'please', 'tell', 'me', 'about',
])

/** The searchable subject of a free-form question (owner order
 *  2026-11-03: ANY question gets searched, not just preset ones). */
export function searchQueryFor(question: string): string {
  const cleaned = normalizeCommand(question)
    .split(' ')
    .map(cleanToken)
    .filter((w) => w && !QUESTION_STOP.has(w))
    .join(' ')
    .trim()
  return cleaned.length >= 2 ? cleaned : normalizeCommand(question).replace(/[؟?]/g, '').trim()
}

function numbersIn(s: string): number[] {
  return (s.match(/\d+/g) ?? []).map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n))
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

// ---- Command parsing -----------------------------------------------------

export function parseAssistantCommand(raw: string): AssistantAction {
  const input = raw.trim()
  const s = normalizeCommand(raw)
  if (!s) return { kind: 'unknown', input }

  const has = (...words: string[]) => words.some((w) => s.includes(w))

  // Help first: «کمک», «چه کار می‌توانی», «help»
  if (/^(کمک|راهنما|help)/.test(s) || has('چه کار می توانی', 'چه کارهایی', 'دستورها')) {
    return { kind: 'help' }
  }

  // Selection transforms (verb forms that point at existing text).
  if (/(تیترش|سرخطش|عنوانش)/.test(s) || (has('تیتر', 'heading', 'عنوان') && has('کن', 'بکن', 'تبدیل', 'make', 'convert'))) {
    const lvl = s.includes('2') || has('دوم', 'two') ? 2 : s.includes('3') || has('سوم', 'three') ? 3 : 1
    return { kind: 'selection-heading', level: lvl as 1 | 2 | 3 }
  }
  if (has('درشت', 'پررنگ', 'bold', 'توپر')) return { kind: 'selection-bold' }
  if (has('تمیز', 'پاکسازی', 'پاک سازی', 'فاصله ها', 'مرتبش', 'clean', 'cleanup')) {
    return { kind: 'selection-cleanup' }
  }

  // Summaries / key points / stats.
  if (has('خلاصه', 'summar', 'summary')) {
    if (has('انتخاب', 'این متن', 'این پاراگراف', 'پاراگراف', 'selection', 'selected')) {
      return { kind: 'selection-summarize' }
    }
    return { kind: 'document-summarize' }
  }
  if (has('نکات کلیدی', 'نکات مهم', 'نکته های مهم', 'key point')) return { kind: 'document-keypoints' }
  if (has('چند کلمه', 'چند حرف', 'آمار', 'word count', 'statistics', 'چند پاراگراف')) {
    return { kind: 'document-stats' }
  }

  // Web research (owner order 2026-11-03): the user explicitly asks
  // the assistant to search/research the internet and write from it.
  // The panel calls our own Supabase function; the draft is assembled
  // from the source's own sentences WITH the source credited.
  const tokens = s.split(' ')
  if (tokens.includes('اینترنت') || tokens.includes('وب') || tokens.includes('search') ||
      has('internet', 'online', 'آنلاین') ||
      /(تحقیق کن|سرچ کن|جستجو کن|search for|research)/.test(s)) {
    const topic = extractResearchTopic(s)
    if (topic.length >= 2) {
      const pNum = s.match(/(\d+)\s*(پاراگراف|paragraph)/)
      // Length by PAGES when the user names pages (owner order
      // 2026-11-03: 1 page = 1 page, 30 pages = 30 pages) — digits or
      // Persian number words.
      const pgNum = s.match(/(\d+)\s*(صفحه|صفحات|pages?)/)
      const FA_PAGE_WORDS: Record<string, number> = {
        یک: 1, دو: 2, سه: 3, چهار: 4, پنج: 5, شش: 6, هفت: 7, هشت: 8, نه: 9,
        ده: 10, پانزده: 15, بیست: 20, سی: 30,
      }
      const pgWord = s.match(/(یک|دو|سه|چهار|پنج|شش|هفت|هشت|نه|ده|پانزده|بیست|سی)\s+صفحه/)
      const pages = pgNum ? parseInt(pgNum[1], 10) : pgWord ? FA_PAGE_WORDS[pgWord[1]] : undefined
      // Owner order 2026-11-03: obey the user about TYPING it into
      // the document — "تایپ نکن / فقط نشان بده" means prepare and
      // preview only; anything else inserts (the standing default).
      const noType = /تایپ نکن|درج نکن|در سند ننویس|داخل سند ننویس|فقط نشان|فقط نمایش|don't type|do not type|don't insert|do not insert|just show|preview only/
        .test(s)
      return {
        kind: 'research', topic,
        paragraphs: clamp(pNum ? parseInt(pNum[1], 10) : 3, 1, 6),
        pages: pages !== undefined ? clamp(pages, 1, 30) : undefined,
        insert: !noType,
      }
    }
  }

  // Table: «جدول ۳×۴ بساز» / «یک جدول بساز» / "table 4x5"
  if (has('جدول', 'table')) {
    const nums = numbersIn(s)
    const rows = clamp(nums[0] ?? 3, 1, 15)
    const cols = clamp(nums[1] ?? nums[0] ?? 3, 1, 8)
    return { kind: 'insert-table', rows, cols }
  }

  // Templates.
  if (has('سی وی', 'سی‌وی', 'رزومه', 'cv', 'resume')) return { kind: 'insert-template', template: 'cv' }
  if (has('نامه', 'letter') && has('رسمی', 'اداری', 'قالب', 'بساز', 'بنویس', 'formal')) {
    return { kind: 'insert-template', template: 'letter' }
  }
  if (has('صفحه عنوان', 'صفحهٔ عنوان', 'کاور', 'cover page', 'cover')) {
    return { kind: 'insert-template', template: 'cover' }
  }
  // Free-writing requests → the essay template, honestly offered: the
  // assistant builds the structure; it does not invent the essay text.
  const essayTopic = s.match(/(?:مقاله|انشا|متن|تحقیق)(?:ای|ي)?\s+(?:درباره|در باره|about)\s+(.+?)(?:\s+(?:بنویس|بساز|بنویسى|write))?$/) ??
                     s.match(/(?:درباره|در باره|about)\s+(.+?)\s*(?:مقاله|انشا|متن|تحقیق)?\s*(?:بنویس|بساز|write)$/)
  if (essayTopic || (has('مقاله', 'انشا', 'essay') && has('بنویس', 'بساز', 'write', 'قالب', 'ساختار'))) {
    const topic = essayTopic?.[1]?.trim()
    return { kind: 'insert-template', template: 'essay', topic: topic || undefined }
  }
  if (has('قالب مقاله', 'ساختار مقاله', 'essay')) return { kind: 'insert-template', template: 'essay' }

  // Page break / date.
  if (has('صفحه جدید', 'صفحه تازه', 'صفحهٔ جدید', 'page break', 'شکست صفحه', 'صفحه بعد')) {
    return { kind: 'insert-page-break' }
  }
  if (has('تاریخ امروز', 'تاریخ را', 'درج تاریخ', 'insert date', 'today')) {
    return { kind: 'insert-date' }
  }

  // Heading with literal text: «تیتر: ...» / «عنوان ... بنویس» / "heading: ..."
  const headingMatch = input.match(/(?:تیتر|عنوان|سرخط|heading|title)\s*[:：]\s*(.+)/i) ??
                       normalizeCommand(input).match(/(?:تیتر|عنوان)\s+(.+?)\s*(?:بنویس|بساز|اضافه کن)$/)
  if (headingMatch) {
    const text = headingMatch[1].trim()
    if (text) return { kind: 'insert-heading', level: 1, text }
  }
  if (has('تیتر', 'heading', 'عنوان') && has('بساز', 'اضافه', 'بنویس', 'add', 'insert')) {
    return { kind: 'insert-heading', level: 1, text: '' }
  }

  // List: «فهرست: سیب، موز» / «لیست بساز» / "list: a, b"
  const listMatch = input.match(/(?:فهرست|لیست|list)\s*[:：]\s*(.+)/i)
  if (listMatch || has('فهرست', 'لیست', 'list')) {
    const ordered = has('شماره', 'number', 'مرقم', 'عددی')
    const items = listMatch
      ? listMatch[1].split(/[،,؛;\n]/).map((x) => x.trim()).filter(Boolean)
      : []
    return { kind: 'insert-list', ordered, items }
  }

  // Literal write: «بنویس: ...» — the user's own words, inserted as-is.
  const writeMatch = input.match(/^(?:بنویس|بنویسى|write|type)\s*[:：]\s*(.+)/is)
  if (writeMatch) return { kind: 'insert-text', text: writeMatch[1].trim() }

  // Simple arithmetic is answered by the assistant's OWN engine,
  // instantly, with no internet (owner order 2026-11-03: any kind of
  // question). Anchored patterns only, so build commands like
  // «جدول ۳×۴ بساز» are never hijacked.
  const fmtNum = (n: number) => String(Math.round(n * 10000) / 10000)
  const pct = s.match(/^(\d+(?:\.\d+)?)\s*(?:درصد|%|٪)\s*(?:از\s*)?(\d+(?:\.\d+)?)\s*(?:چند می شود|چند است)?\s*[=؟?]?$/)
  if (pct) {
    const a = parseFloat(pct[1]); const b = parseFloat(pct[2])
    return { kind: 'answer-local', lines: [`${fmtNum(a)}٪ × ${fmtNum(b)} = ${fmtNum((a * b) / 100)}`] }
  }
  const arith = s.match(/^(-?\d+(?:\.\d+)?)\s*([+\-×x*\/÷])\s*(-?\d+(?:\.\d+)?)\s*(?:چند می شود|چند است)?\s*[=؟?]?$/)
  if (arith) {
    const a = parseFloat(arith[1]); const b = parseFloat(arith[3])
    const op = arith[2]
    const shown = op === 'x' || op === '*' ? '×' : op === '/' ? '÷' : op
    const value = op === '+' ? a + b : op === '-' ? a - b
      : shown === '×' ? a * b : b === 0 ? NaN : a / b
    if (Number.isFinite(value)) {
      return { kind: 'answer-local', lines: [`${fmtNum(a)} ${shown} ${fmtNum(b)} = ${fmtNum(value)}`] }
    }
  }

  // ANY free-form question (owner order 2026-11-03: «هر نوع سوالی را
  // جواب بدهد» — not just preset commands): the assistant searches
  // the web itself and answers from sources, in seconds.
  const QUESTION_START = /^(چیست|چه|چرا|چگونه|چطور|کی|کجا|کجاست|کدام|چند|آیا|what|why|how|when|where|who|which|is|are|can|does|do)\b/
  if (/[؟?]$/.test(s) || QUESTION_START.test(s)) {
    return { kind: 'answer', question: input }
  }

  return { kind: 'unknown', input }
}

// ---- Text algorithms (all local, all honest) ------------------------------

/** Tidy spacing/punctuation: collapse runs of spaces, remove the space
 *  before punctuation, ensure one space after it, drop 3+ blank lines. */
export function cleanupText(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/ +([،.,؛؛:!؟?٪%])/g, '$1')
    .replace(/([،؛:!؟?٪%])(?=[^\s\d])/g, '$1 ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n').map((l) => l.trim()).join('\n')
    .trim()
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.。؟?!\n])\s+|\n+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 1)
}

const STOPWORDS = new Set([
  'است', 'بود', 'شد', 'می', 'نمی', 'را', 'به', 'از', 'در', 'با', 'که', 'این', 'آن', 'و',
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'is', 'are', 'was', 'were', 'it', 'that', 'this',
])

function wordFreq(text: string): Map<string, number> {
  const freq = new Map<string, number>()
  for (const w of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (w.length < 3 || STOPWORDS.has(w)) continue
    freq.set(w, (freq.get(w) ?? 0) + 1)
  }
  return freq
}

/** Extractive summary: the document's own most central sentences, in
 *  original order. This is the document's real sentences — never
 *  invented text. */
export function summarizeText(text: string, maxSentences = 3): string[] {
  const sentences = splitSentences(text)
  if (sentences.length <= maxSentences) return sentences
  const freq = wordFreq(text)
  const scored = sentences.map((sentence, idx) => {
    const words = sentence.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    const score = words.length === 0 ? 0 : words.reduce((acc, w) => acc + (freq.get(w) ?? 0), 0) / words.length
    return { sentence, idx, score: score + (idx === 0 ? 0.25 : 0) }
  })
  return scored
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSentences)
    .sort((a, b) => a.idx - b.idx)
    .map((x) => x.sentence)
}

export function keyPoints(text: string, maxPoints = 5): string[] {
  return summarizeText(text, maxPoints)
}

// ---- Templates (TipTap JSON) ----------------------------------------------

type JsonNode = Record<string, unknown>
const txt = (text: string): JsonNode => ({ type: 'text', text })
const para = (text = ''): JsonNode => ({ type: 'paragraph', content: text ? [txt(text)] : [] })
const head = (level: number, text: string): JsonNode => ({ type: 'heading', attrs: { level }, content: [txt(text)] })
const bullet = (items: string[]): JsonNode => ({
  type: 'bulletList',
  content: items.map((i) => ({ type: 'listItem', content: [para(i)] })),
})

export interface ResearchData {
  title: string
  extract: string
  url: string
  /** Display site name for general-web sources (A-01d); Wikipedia
   *  sources carry none — their name is derived from the URL. */
  site?: string
}

/** Display name for a source's credit line (A-01d): a wikipedia.org
 *  URL is always «ویکی‌پدیا» / «Wikipedia»; otherwise the source's
 *  own site field, else its bare hostname without www. */
export function sourceSiteName(src: Pick<ResearchData, 'url' | 'site'>, lang: 'fa' | 'en'): string {
  try {
    const host = new URL(src.url).hostname
    if (host.endsWith('wikipedia.org')) return lang === 'fa' ? 'ویکی‌پدیا' : 'Wikipedia'
    if (src.site) return src.site
    return host.replace(/^www\./, '')
  } catch {
    return src.site ?? (lang === 'fa' ? 'ویکی‌پدیا' : 'Wikipedia')
  }
}

const isWikiUrl = (u: string): boolean => {
  try { return new URL(u).hostname.endsWith('wikipedia.org') } catch { return u.includes('wikipedia.org') }
}

/** Words per page calibrated to Vyro's OWN A4 pagination (live
 *  measurements 2026-11-03: 1,024 words → 3 pages unsectioned; 821
 *  words → 3 pages with many section headings; 300 sits between). */
export const WORDS_PER_PAGE = 300
const WORDS_PER_PARAGRAPH = 110

export interface ResearchAssembly { nodes: JsonNode[]; words: number; targetWords: number }

/** Word counting aligned with the app's own statistics engine:
 *  split on anything that is not a letter/digit/ZWNJ, so punctuation
 *  and URLs tokenize the same way the status bar counts them, while
 *  ZWNJ-joined Persian words stay one word («می‌کنم» = 1). */
const countWords = (s: string) =>
  s.split(/[^\p{L}\p{N}\u200C]+/u).filter((t) => t.length > 0).length

const nodeText = (n: JsonNode): string => {
  const own = typeof n.text === 'string' ? n.text : ''
  const kids = Array.isArray(n.content) ? (n.content as JsonNode[]).map(nodeText).join(' ') : ''
  return own + kids
}

export interface ResearchSection { heading: string | null; text: string }

/** Strip the light wiki markup of Wikipedia's wiki-format extracts
 *  ([[links]], bold/italic ticks, [n] reference markers, stray tags)
 *  so the assembled sentences read clean and professional. */
export function cleanWikiText(raw: string): string {
  return raw
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/'''([^']+)'''/g, '$1')
    .replace(/''([^']+)''/g, '$1')
    .replace(/\[[\d۰-۹]+\]/g, '')
    .replace(/<[^>]+>/g, ' ')
}

/** Split a wiki-format extract into its REAL sections: "== Title =="
 *  lines become section headings; the text before the first heading
 *  is the article's lead. Plain extracts (no markers) return a single
 *  lead section. */
export function parseSections(extract: string): ResearchSection[] {
  const sections: ResearchSection[] = [{ heading: null, text: '' }]
  for (const line of cleanWikiText(extract).split('\n')) {
    const m3 = line.match(/^===\s*(.+?)\s*===$/)
    const m2 = line.match(/^==\s*([^=]+?)\s*==$/)
    if (m3 || m2) sections.push({ heading: (m3?.[1] ?? m2?.[1] ?? '').trim(), text: '' })
    else sections[sections.length - 1].text += line + '\n'
  }
  return sections
    .map((s) => ({ heading: s.heading, text: s.text.trim() }))
    .filter((s) => s.text.length > 0)
}

const usableSentence = (s: string) =>
  countWords(s) >= 5 && !/https?:\/\//.test(s) && !s.includes('==')

const fingerprint = (s: string) => s.replace(/\s+/g, ' ').slice(0, 36)

/** Assemble a research draft from fetched sources (owner orders
 *  2026-11-03: the most precise search; a PROFESSIONAL build — the
 *  article's real section headings, clean edited text, no duplicate
 *  sentences; the LENGTH asked — pages when pages are named,
 *  otherwise paragraphs; and a reported word count that counts
 *  EVERYTHING inserted, so the report matches the document). Title,
 *  the best source's lead as the introduction, then each section's
 *  strongest sentences (the sources' OWN words, original order) —
 *  and ALWAYS a closing credit of every source used, built here in
 *  the engine so the UI cannot drop it. If the sources run out
 *  first, the draft is honestly shorter; nothing is ever padded with
 *  invented text. */
export function assembleResearch(
  sources: ResearchData[],
  lang: 'fa' | 'en',
  opts: { pages?: number; paragraphs?: number } = {},
): ResearchAssembly {
  const targetWords = opts.pages ? opts.pages * WORDS_PER_PAGE : (opts.paragraphs ?? 3) * WORDS_PER_PARAGRAPH
  const nodes: JsonNode[] = []
  let words = 0
  const add = (n: JsonNode) => { nodes.push(n); words += countWords(nodeText(n)) }
  if (sources.length === 0) return { nodes, words, targetWords }
  const seen = new Set<string>()
  const main = sources[0]
  add(head(1, main.title))

  // Emit one section's best sentences as paragraphs, honouring the
  // remaining room AND a per-section budget: the (often huge) lead
  // must never swallow the whole document — a professional draft is
  // balanced across the article's real sections (v2.4, from the live
  // check where a long lead ate the full two pages and no section
  // heading survived).
  const emitSentences = (sentences: string[], budgetWords = Number.POSITIVE_INFINITY) => {
    let buf: string[] = []
    let bufWords = 0
    const flush = () => {
      if (buf.length === 0) return
      add(para(buf.join(' ')))
      buf = []; bufWords = 0
    }
    let sectionWords = 0
    for (const sentence of sentences) {
      const fp = fingerprint(sentence)
      if (seen.has(fp)) continue
      const w = countWords(sentence)
      if (words + bufWords + w > targetWords + 30 && buf.length > 0) break
      if (sectionWords + w > budgetWords && sectionWords > 0) break
      seen.add(fp)
      buf.push(sentence); bufWords += w; sectionWords += w
      if (bufWords >= WORDS_PER_PARAGRAPH) flush()
    }
    flush()
  }

  const allSections = sources.map((src) => parseSections(src.extract))
  const totalSections = allSections.reduce((acc, arr) => acc + arr.length, 0)
  const leadBudget = totalSections <= 1 ? Number.POSITIVE_INFINITY : Math.max(120, Math.floor(targetWords * 0.3))
  const sectionBudget = totalSections <= 1 ? Number.POSITIVE_INFINITY : Math.max(150, Math.floor(targetWords * 0.45))

  sources.forEach((src, si) => {
    const sections = allSections[si]
    sections.forEach((section, idx) => {
      if (words >= targetWords) return
      const sentences = splitSentences(section.text).filter(usableSentence)
      if (sentences.length === 0) return
      if (si === 0 && idx === 0) {
        // The lead: its first two sentences are the introduction;
        // the rest flows on as unheaded body text, within budget.
        const lead = sentences.slice(0, 2)
        if (lead.length > 0) {
          lead.forEach((s) => seen.add(fingerprint(s)))
          add(para(lead.join(' ')))
        }
        const rest = summarizeText(sentences.slice(2).join(' '), Math.max(6, Math.ceil((targetWords - words) / 16)))
          .filter(usableSentence)
        emitSentences(rest, Math.max(0, leadBudget - (words - countWords(main.title))))
        return
      }
      const picked = summarizeText(sentences.join(' '), Math.max(6, Math.ceil((targetWords - words) / 16)))
        .filter(usableSentence)
      const fresh = picked.filter((s) => !seen.has(fingerprint(s)))
      if (fresh.length === 0) return
      const heading = section.heading ?? (si > 0 ? src.title : null)
      if (heading) add(head(2, heading))
      emitSentences(fresh, sectionBudget)
    })
  })

  // Top-up pass: the section budgets guarantee balance, not
  // under-fill — when every section had its turn and room remains,
  // fill the rest from the sections' leftover sentences, in order.
  if (words < targetWords * 0.92) {
    for (const sections of allSections) {
      if (words >= targetWords) break
      for (const section of sections) {
        if (words >= targetWords) break
        const leftover = splitSentences(section.text).filter(usableSentence)
        emitSentences(leftover)
      }
    }
  }

  // A-01d: credits are generalized — every source is credited by
  // its own site name (Wikipedia by URL, web sources by their site
  // field or hostname). The credit is built here in the engine, so
  // the UI can never drop a source.
  if (sources.length === 1) {
    add(para(lang === 'fa' ? `منبع: ${sourceSiteName(main, lang)} — ${main.url}` : `Source: ${sourceSiteName(main, lang)} — ${main.url}`))
  } else {
    add(para(lang === 'fa' ? 'منابع:' : 'Sources:'))
    for (const src of sources) {
      add(para(`${sourceSiteName(src, lang)} — ${src.url}`))
    }
  }
  return { nodes, words, targetWords }
}

/** Single-article convenience wrapper (paragraph mode). */
export function buildResearchDoc(data: ResearchData, lang: 'fa' | 'en', paragraphCount = 3): JsonNode[] {
  return assembleResearch([data], lang, { paragraphs: paragraphCount }).nodes
}

/** Answer a free-form question from the fetched sources (owner order
 *  2026-11-03: any kind of question, answered in seconds). The
 *  answer is the sources' own sentences that best match the
 *  question's subject — extractive, never invented — and it always
 *  ends with the source credit. When no sentence matches the
 *  subject, found is false and the panel says so honestly. */
export function buildAnswer(
  sources: ResearchData[],
  question: string,
  lang: 'fa' | 'en',
): { lines: string[]; found: boolean } {
  const qTokens = new Set(searchQueryFor(question).split(' ').filter((w) => w.length > 1))
  if (qTokens.size === 0 || sources.length === 0) return { lines: [], found: false }
  interface Cand { text: string; score: number; order: number; url: string; site?: string }
  const cands: Cand[] = []
  let order = 0
  for (const src of sources) {
    for (const section of parseSections(src.extract)) {
      for (const sentence of splitSentences(section.text)) {
        if (!usableSentence(sentence)) continue
        const toks = new Set(sentence.toLowerCase().split(/[^\p{L}\p{N}\u200C]+/u))
        let score = 0
        qTokens.forEach((t) => { if (toks.has(t)) score++ })
        cands.push({ text: sentence, score, order: order++, url: src.url, site: src.site })
      }
    }
  }
  // Strictness (v2.4, from the live France/Korea failure): when the
  // question names two or more subject words, an answer sentence
  // must match at least TWO of them — matching only a generic word
  // like «پایتخت» in an article about another country is not an
  // answer. Otherwise the honest result is "not found".
  const minScore = qTokens.size >= 2 ? 2 : 1
  const best = cands
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, 3)
    .sort((a, b) => a.order - b.order)
  if (best.length === 0 && qTokens.size >= 2) {
    // A-01c fallback (live failure 2026-11-03: «نویسنده شاهنامه
    // کیست؟»): the true sentence «شاهنامه اثر فردوسی است» matches
    // only ONE subject token, because the article phrases the
    // relation differently (نویسنده → اثر). When the strict pass
    // finds nothing, fall back — TOP source only, never a secondary
    // source — to sentences that match the topic token (a subject
    // token present in the top source's title, else the longest
    // subject token) AND at least one other subject token or its
    // light synonym. The France/Korea guard survives: a Korea
    // article's sentences match «پایتخت» but never «فرانسه» or any
    // of its synonyms, so the fallback still returns not-found.
    const SYNONYMS: Record<string, string[]> = {
      'نویسنده': ['اثر', 'مولف', 'سراینده'],
      'اثر': ['نویسنده'],
      author: ['written', 'wrote', 'writer'],
      writer: ['author', 'wrote'],
      written: ['author'],
      wrote: ['author', 'written', 'writer'],
      // A-01d ranking synonyms (ZWNJ forms normalized: the question
      // tokenizes «قوی‌ترین» as «قوی» + «تر», so both forms map).
      'قوی‌ترین': ['قوی', 'برتر', 'پیشرو', 'اول'],
      'قویترین': ['قوی', 'برتر', 'پیشرو', 'اول'],
      'قوی': ['برتر', 'پیشرو', 'اول'],
      'بهترین': ['قوی', 'برتر', 'پیشرو', 'اول'],
      'بهتر': ['برتر', 'اول'],
      strongest: ['strong', 'top', 'leading', 'first'],
      best: ['strongest', 'top', 'leading', 'first'],
      top: ['best', 'leading', 'first'],
      ranking: ['rank', 'best', 'top'],
      latest: ['newest', 'recent'],
    }
    const top = sources[0]
    const titleToks = new Set(top.title.toLowerCase().split(/[^\p{L}\p{N}\u200C]+/u))
    const ordered = searchQueryFor(question).split(' ').filter((w) => w.length > 1)
    let topic = ordered.filter((t) => titleToks.has(t))
    if (topic.length === 0) {
      const longest = Math.max(...ordered.map((t) => t.length))
      topic = [ordered.find((t) => t.length === longest) as string]
    }
    const topicSet = new Set(topic)
    const otherToks = new Set<string>()
    qTokens.forEach((t) => {
      if (!topicSet.has(t)) otherToks.add(t)
      ;(SYNONYMS[t] ?? []).forEach((s) => otherToks.add(s))
    })
    const fb = cands
      .filter((c) => c.url === top.url)
      .filter((c) => {
        const toks = new Set(c.text.toLowerCase().split(/[^\p{L}\p{N}\u200C]+/u))
        const hasTopic = topic.some((t) => toks.has(t))
        const hasOther = [...otherToks].some((t) => toks.has(t))
        return hasTopic && hasOther
      })
      .sort((a, b) => a.order - b.order)
      .slice(0, 2)
    if (fb.length > 0) {
      const lines = fb.map((c) => c.text)
      lines.push(lang === 'fa' ? `منبع: ${sourceSiteName(top, lang)} — ${top.url}` : `Source: ${sourceSiteName(top, lang)} — ${top.url}`)
      return { lines, found: true }
    }
    // A-01d WHOLE-WEB fallback: ONLY non-Wikipedia sources, in
    // order — a Wikipedia secondary source can never be rescued by
    // this pass (the France/Korea guard). Same shape as A-01c, but
    // the topic token is taken from EACH web source's own title
    // (else the longest subject token), and the sentence must match
    // it AND another subject token or a light synonym. A winner or
    // ranking is stated only when the fetched source's OWN sentence
    // states it — never invented. At most 2 sentences + that
    // source's site credit.
    for (const ws of sources.filter((s) => !isWikiUrl(s.url))) {
      const wTitleToks = new Set(ws.title.toLowerCase().split(/[^\p{L}\p{N}\u200C]+/u))
      let wtopic = ordered.filter((t) => wTitleToks.has(t))
      if (wtopic.length === 0) {
        const longest = Math.max(...ordered.map((t) => t.length))
        wtopic = [ordered.find((t) => t.length === longest) as string]
      }
      const wtopicSet = new Set(wtopic)
      const wother = new Set<string>()
      qTokens.forEach((t) => {
        if (!wtopicSet.has(t)) wother.add(t)
        ;(SYNONYMS[t] ?? []).forEach((s) => wother.add(s))
      })
      const wb = cands
        .filter((c) => c.url === ws.url)
        .filter((c) => {
          const raw = new Set(c.text.toLowerCase().split(/[^\p{L}\p{N}\u200C]+/u))
          // ZWNJ-joined words also count as their parts, so a
          // sentence's «قوی‌ترین» matches the question token «قوی».
          const toks = new Set<string>(raw)
          raw.forEach((t) => t.split('\u200C').forEach((p) => { if (p) toks.add(p) }))
          return wtopic.some((t) => toks.has(t)) && [...wother].some((t) => toks.has(t))
        })
        .sort((a, b) => a.order - b.order)
        .slice(0, 2)
      if (wb.length > 0) {
        const lines = wb.map((c) => c.text)
        lines.push(lang === 'fa' ? `منبع: ${sourceSiteName(ws, lang)} — ${ws.url}` : `Source: ${sourceSiteName(ws, lang)} — ${ws.url}`)
        return { lines, found: true }
      }
    }
    return { lines: [], found: false }
  }
  if (best.length === 0) return { lines: [], found: false }
  const lines = best.map((c) => c.text)
  for (const url of [...new Set(best.map((c) => c.url))].slice(0, 2)) {
    const cand = best.find((c) => c.url === url) as Cand
    lines.push(lang === 'fa' ? `منبع: ${sourceSiteName({ url, site: cand.site }, lang)} — ${url}` : `Source: ${sourceSiteName({ url, site: cand.site }, lang)} — ${url}`)
  }
  return { lines, found: true }
}

/** Ready-made document structures in the app's own document format.
 *  Placeholder lines are the user's to fill — the assistant builds the
 *  structure, never fake content. */
export function buildTemplate(kind: AssistantTemplateKind, lang: 'fa' | 'en', topic?: string): JsonNode[] {
  if (lang === 'en') {
    switch (kind) {
      case 'cover':
        return [head(1, topic ?? 'Assignment Title'), para('Student name: …'), para('Instructor: …'), para('Subject: …'), para('Date: …')]
      case 'letter':
        return [para('Dear Sir/Madam,'), para('With respect, …'), para('…'), para('Sincerely,'), para('Name & signature: …')]
      case 'cv':
        return [head(1, 'Curriculum Vitae'), head(2, 'Personal information'), bullet(['Name: …', 'Phone: …', 'Email: …']),
          head(2, 'Education'), bullet(['…']), head(2, 'Skills'), bullet(['…']), head(2, 'Work experience'), bullet(['…'])]
      case 'essay':
        return [head(1, topic ?? 'Essay title'), head(2, 'Introduction'), para('…'), head(2, 'Body'), para('…'), para('…'), head(2, 'Conclusion'), para('…')]
    }
  }
  switch (kind) {
    case 'cover':
      return [head(1, topic ?? 'عنوان اساینمنت'), para('نام محصل: …'), para('نام استاد: …'), para('مضمون: …'), para('تاریخ: …')]
    case 'letter':
      return [para('ریاست محترم …'), para('با سلام و احترام،'), para('…'), para('با تشکر و احترام'), para('نام و امضا: …')]
    case 'cv':
      return [head(1, 'رزومه (سی‌وی)'), head(2, 'اطلاعات شخصی'), bullet(['نام: …', 'تلفن: …', 'ایمیل: …']),
        head(2, 'تحصیلات'), bullet(['…']), head(2, 'مهارت‌ها'), bullet(['…']), head(2, 'تجربهٔ کاری'), bullet(['…'])]
    case 'essay':
      return [head(1, topic ?? 'عنوان مقاله'), head(2, 'مقدمه'), para('…'), head(2, 'بدنهٔ مقاله'), para('…'), para('…'), head(2, 'نتیجه‌گیری'), para('…')]
  }
}
