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
  | { kind: 'research'; topic: string; paragraphs: number; pages?: number }
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
  'ده', 'پانزده', 'بیست', 'سی',
  'essay', 'write', 'search', 'research', 'internet', 'web', 'online', 'the', 'for',
  'about', 'make', 'an', 'a', 'article', 'text', 'find', 'paragraph', 'paragraphs', 'and',
])

/** The topic left after the command words are removed. */
export function extractResearchTopic(normalized: string): string {
  return normalized
    .split(' ')
    .filter((w) => w && !RESEARCH_STOP.has(w) && !/^\d+$/.test(w))
    .join(' ')
    .trim()
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
      return {
        kind: 'research', topic,
        paragraphs: clamp(pNum ? parseInt(pNum[1], 10) : 3, 1, 6),
        pages: pages !== undefined ? clamp(pages, 1, 30) : undefined,
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
}

export const WORDS_PER_PAGE = 480
const WORDS_PER_PARAGRAPH = 110

export interface ResearchAssembly { nodes: JsonNode[]; words: number; targetWords: number }

const countWords = (s: string) => s.split(/\s+/).filter(Boolean).length

/** Assemble a research draft from fetched sources (owner orders
 *  2026-11-03: precise search; write to the LENGTH asked — pages when
 *  pages are named, otherwise paragraphs). Title, the best source's
 *  lead as the introduction, then the sources' strongest sentences
 *  (their OWN words, original order) sectioned per source until the
 *  target length is reached — and ALWAYS a closing credit of every
 *  source used. The credit is part of the honesty contract: it is
 *  built here, in the engine, and cannot be dropped by the UI. If the
 *  sources run out first, the draft is honestly shorter — the caller
 *  reports the real size; nothing is ever padded with invented text. */
export function assembleResearch(
  sources: ResearchData[],
  lang: 'fa' | 'en',
  opts: { pages?: number; paragraphs?: number } = {},
): ResearchAssembly {
  const targetWords = opts.pages ? opts.pages * WORDS_PER_PAGE : (opts.paragraphs ?? 3) * WORDS_PER_PARAGRAPH
  const nodes: JsonNode[] = []
  let words = 0
  if (sources.length === 0) return { nodes, words, targetWords }
  const main = sources[0]
  nodes.push(head(1, main.title))
  const lead = splitSentences(main.extract).slice(0, 2)
  if (lead.length > 0) {
    nodes.push(para(lead.join(' ')))
    words += countWords(lead.join(' '))
  }
  const multiSection = sources.length > 1 && (opts.pages ?? 0) >= 2
  sources.forEach((src, si) => {
    if (words >= targetWords) return
    const sentences = splitSentences(src.extract)
    const body = si === 0 ? sentences.slice(lead.length) : sentences
    if (body.length === 0) return
    // This source's strongest sentences, in its own order, sized to
    // the room left (first source gets the biggest share).
    const roomWords = targetWords - words
    const quota = Math.max(6, Math.ceil(roomWords / 18))
    const picked = summarizeText(body.join(' '), quota)
    if (picked.length === 0) return
    if (multiSection) nodes.push(head(2, src.title))
    let buf: string[] = []
    let bufWords = 0
    const flush = () => {
      if (buf.length === 0) return
      nodes.push(para(buf.join(' ')))
      buf = []; bufWords = 0
    }
    for (const sentence of picked) {
      if (words >= targetWords && buf.length > 0) break
      buf.push(sentence)
      const w = countWords(sentence)
      bufWords += w; words += w
      if (bufWords >= WORDS_PER_PARAGRAPH) flush()
    }
    flush()
  })
  if (sources.length === 1) {
    nodes.push(para(lang === 'fa' ? `منبع: ویکی‌پدیا — ${main.url}` : `Source: Wikipedia — ${main.url}`))
  } else {
    nodes.push(para(lang === 'fa' ? 'منابع:' : 'Sources:'))
    for (const src of sources) {
      nodes.push(para(lang === 'fa' ? `ویکی‌پدیا — ${src.url}` : `Wikipedia — ${src.url}`))
    }
  }
  return { nodes, words, targetWords }
}

/** Single-article convenience wrapper (paragraph mode). */
export function buildResearchDoc(data: ResearchData, lang: 'fa' | 'en', paragraphCount = 3): JsonNode[] {
  return assembleResearch([data], lang, { paragraphs: paragraphCount }).nodes
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
