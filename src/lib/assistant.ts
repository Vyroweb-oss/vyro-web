import { computePagination } from './pagination'
import { usableHeightMm, usableWidthMm, PAGE_SIZES, MARGIN_PRESETS } from './pageSetup'

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

/** Ranking / comparison / current questions (A-01d2): these have no
 *  single generic article answer, so a generic Wikipedia match must
 *  never pre-empt the web answer — the web fallback runs first, and
 *  Wikipedia wins only when its own sentence states the ranking.
 *  Token-based on the NORMALIZED question (ZWNJ becomes a space, so
 *  «قوی‌ترین» tokenizes as «قوی» + «ترین»). Mirrors the function
 *  side's looksRankingOrCurrent, plus the «ترین» superlative form. */
const RANKING_QUESTION_TOKENS = new Set([
  'قوی', 'ترین', 'قویترین', 'بهترین', 'برتر', 'آخرین', 'جدیدترین', 'مقایسه', 'رتبه',
  'strongest', 'best', 'latest', 'top', 'ranking', 'compare', 'comparison', 'fastest', 'newest',
])
export function isRankingOrCurrentQuestion(question: string): boolean {
  const toks = new Set(normalizeCommand(question).split(' ').filter(Boolean))
  return [...RANKING_QUESTION_TOKENS].some((t) => toks.has(t))
}

// ---- A-01e question analysis ------------------------------------------------
// Owner order 2026-11-03 ~22:16: teach the assistant to analyze each
// question BEFORE answering, and to analyze candidate answers against
// the question before replying. The failure behind generic-definition
// answers: a sentence can share words with the question («شاهنامه»،
// «نویسنده») without answering it. So a question is classified into a
// type, its true subject tokens are extracted, and the kind of
// sentence that counts as an answer is fixed up front; candidate
// sentences are then checked against that kind, not just against word
// overlap. This layer only PREFERS type-matching sentences inside
// buildAnswer — every legacy pass below (strict, A-01c, A-01d web,
// generic-keep) still runs when it finds nothing, so no existing
// behaviour is removed.

export type QuestionType =
  | 'definition' | 'person' | 'date' | 'place' | 'why' | 'how'
  | 'enumeration' | 'ranking' | 'current' | 'quantity' | 'unknown'

export type AnswerKind =
  | 'definition' | 'name' | 'date' | 'place' | 'reason' | 'procedure'
  | 'enumeration' | 'comparative' | 'recent' | 'quantity' | 'any'

export interface QuestionAnalysis {
  type: QuestionType
  /** Searchable subject tokens (searchQueryFor, in order). */
  subjectTokens: string[]
  /** What kind of sentence counts as an answer to this question. */
  answerKind: AnswerKind
}

const STRONG_COMPARATIVE_TOKENS = new Set([
  'قوی', 'بهترین', 'برتر', 'بزرگ', 'اول', 'رتبه',
  'strongest', 'best', 'largest', 'fastest', 'top', 'first', 'ranked',
])

export function analyzeQuestion(question: string): QuestionAnalysis {
  // Strip sentence punctuation from tokens: the trigger word is
  // often the LAST word («فوتوسنتز چیست؟» tokenizes as «چیست؟»,
  // which would otherwise never match «چیست»).
  const toks = new Set(normalizeCommand(question).replace(/[؟?!.,،؛:«»"“”]/g, '').split(' ').filter(Boolean))
  const has = (...words: string[]) => words.some((w) => toks.has(w))
  const subjectTokens = searchQueryFor(question).split(' ').filter((w) => w.length > 1)
  const kind = (type: QuestionType, answerKind: AnswerKind): QuestionAnalysis =>
    ({ type, subjectTokens, answerKind })
  // Ranking / current first: isRankingOrCurrentQuestion already
  // owns this detection (A-01d2); a recency-only question
  // (آخرین/جدیدترین/latest/newest, no strong comparative) is
  // 'current', everything else ranking here is 'ranking'.
  if (isRankingOrCurrentQuestion(question)) {
    if (has('آخرین', 'جدیدترین', 'latest', 'newest') && ![...toks].some((t) => STRONG_COMPARATIVE_TOKENS.has(t))) {
      return kind('current', 'recent')
    }
    return kind('ranking', 'comparative')
  }
  if (has('کیست', 'who', 'نویسنده', 'مولف', 'سراینده', 'wrote', 'written', 'author')) {
    return kind('person', 'name')
  }
  if (has('کجاست', 'کجا', 'where', 'پایتخت', 'capital', 'located')) {
    return kind('place', 'place')
  }
  if (has('when', 'سال', 'سالی', 'چه سالی')) return kind('date', 'date')
  if (has('چند', 'چقدر', 'how many', 'how much', 'سرعت', 'speed', 'قیمت', 'price',
    'طول', 'length', 'ارتفاع', 'height', 'وزن', 'weight', 'فاصله', 'distance', 'تعداد')) {
    return kind('quantity', 'quantity')
  }
  if (has('چرا', 'why')) return kind('why', 'reason')
  if (has('چگونه', 'چطور', 'how')) return kind('how', 'procedure')
  if (has('ببر', 'ببرید', 'فهرست', 'list', 'examples', 'بشمار')) return kind('enumeration', 'enumeration')
  if (has('چیست', 'what', 'تعریف', 'یعنی')) return kind('definition', 'definition')
  return kind('unknown', 'any')
}

/** Query variants chosen from the analysis (A-01e step 2): the panel
 *  still searches the primary query; the variants exist so a later
 *  caller can retry a person question in the source's own phrasing
 *  (نویسنده → اثر, wrote → written by) without rewriting the search
 *  pipeline. searchQueryFor itself is untouched (existing tests pin
 *  it); this only adds variants beside it. */
export function searchQueriesFor(question: string): string[] {
  const primary = searchQueryFor(question)
  const analysis = analyzeQuestion(question)
  const variants: string[] = []
  if (analysis.type === 'person') {
    const toks = primary.split(' ')
    if (toks.includes('نویسنده')) {
      variants.push(toks.map((t) => (t === 'نویسنده' ? 'اثر' : t)).join(' '))
    }
    if (toks.includes('wrote')) {
      variants.push(toks.map((t) => (t === 'wrote' ? 'written by' : t)).join(' '))
    }
  }
  return [...new Set([primary, ...variants.filter((v) => v && v !== primary)])]
}

/** Sentence tokens with ZWNJ-joined words also counted as their
 *  parts, so «قوی‌ترین» matches «قوی» (module-level twin of the
 *  helper already used inside buildAnswer). */
function analysisTokens(text: string): Set<string> {
  const raw = new Set(normalizeDigits(text).toLowerCase().split(/[^\p{L}\p{N}\u200C]+/u))
  const out = new Set<string>(raw)
  raw.forEach((t) => t.split('\u200C').forEach((p) => { if (p) out.add(p) }))
  return out
}

const COMPARATIVE_MARKERS = new Set([
  'قوی', 'ترین', 'بهترین', 'برتر', 'بزرگ', 'اول', 'رتبه',
  'strongest', 'best', 'largest', 'fastest', 'top', 'first', 'ranked',
])
const YEAR_RE = /(1[0-9]{3}|20[0-9]{2})/
const QUANTITY_UNITS = new Set([
  'متر', 'کیلومتر', 'ثانیه', 'دقیقه', 'ساعت', 'کیلوگرم', 'گرم', 'سانتی', 'میلی',
  'm', 'km', 'cm', 'mm', 'kg', 'm/s', 'km/s', 'ms', 'دلار', 'تومان', 'ریال', 'درصد',
  // A-01e2: counts people answer too («۶۸ میلیون نفر») — without
  // these, gating quantity answers by type would wrongly drop them.
  'میلیون', 'میلیارد', 'هزار', 'نفر',
])

/** Does this sentence (the source's own words) actually ANSWER a
 *  question of the given kind — not merely share words with it?
 *  A name-bearing sentence names someone via an author relation
 *  (اثر + name, written by + name); a place-bearing sentence states
 *  a capital/city; a quantity-bearing sentence carries a number with
 *  a unit; a comparative sentence states a superlative/rank. Bare
 *  word-sharing (a definition sentence that happens to mention
 *  «نویسنده») is deliberately NOT enough. */
export function sentenceMatchesQuestionType(sentence: string, analysis: QuestionAnalysis): boolean {
  const toks = analysisTokens(sentence)
  const norm = normalizeDigits(sentence).toLowerCase()
  switch (analysis.answerKind) {
    case 'any': return true
    case 'name': {
      // A-01e2 (author-relation evidence, general): a name-bearing
      // sentence must show the author relation, not merely mention
      // a person near the work. Three general shapes count: (a) an
      // author cue (اثر/مولف/سراینده/نویسنده/نوشته/سروده) directly
      // followed by a non-subject, non-stopword token — «شاهنامه
      // اثر فردوسی است», and NOT «نویسنده آن» (آن is a stopword);
      // (b) the cue, then the work title, then a name closed by a
      // copula — «نویسنده مثنوی معنوی، مولانا است». (b) must NOT
      // accept the first content word after the cue («نویسنده آن
      // داستان‌های…» would falsely pass): only a token followed by
      // است/بود/می‌باشد/باشد counts. (c) LIVE FIX (Masnavi lead:
      // «نام کتاب شعری از مولانا جلال‌الدین محمد بلخی شاعر…»):
      // «از» + a name confirmed within a few words by a person-role
      // word (شاعر/عارف/…) or a copula. (c) deliberately has NO
      // adjacent rule — bare «از X» («از تهران») is not evidence.
      // Loose mentions with no author cue at all («مولانا، شاعر
      // پارسی‌گوی…») do NOT pass.
      const NAME_STOP = new Set(['آن', 'این', 'او', 'را', 'است', 'بود', 'که', 'و', 'در', 'به', 'از', 'یک', 'هم', 'نیز', 'با', 'برای', 'تا', 'خود', 'وی'])
      const COPULA = new Set(['است', 'بود', 'می‌باشد', 'باشد'])
      const ROLE_WORDS = new Set(['شاعر', 'عارف', 'نویسنده', 'مولف', 'سراینده', 'فیلسوف', 'دانشمند', 'ادیب', 'مورخ', 'پزشک'])
      const words = norm.replace(/\u200C/g, ' ').split(/[^\p{L}\p{N}]+/u).filter(Boolean)
      const CUES = ['اثر', 'مولف', 'سراینده', 'نویسنده', 'نوشته', 'سروده']
      for (let i = 0; i < words.length; i++) {
        if (!CUES.includes(words[i])) continue
        if (words[i + 1] && !analysis.subjectTokens.includes(words[i + 1]) && !NAME_STOP.has(words[i + 1])) return true
        for (let j = i + 1; j < Math.min(words.length, i + 8); j++) {
          if (analysis.subjectTokens.includes(words[j]) || NAME_STOP.has(words[j])) continue
          if (COPULA.has(words[j + 1])) return true
        }
      }
      // (c) refined: a bare copula far away («از تهران … است»)
      // must NOT confirm — the name run after از must reach a role
      // word, or end in a copula with NO function word in between
      // («از مولانا جلال‌الدین محمد بلخی است» counts; «از تهران به
      // دست ما رسیده است» does not, because به breaks the run).
      const SCAN_FUNCTION = new Set(['به', 'در', 'از', 'با', 'برای', 'که', 'را', 'و', 'این', 'آن', 'تا', 'هم', 'نیز', 'بر', 'بی', 'چون', 'اگر', 'اما', 'یا'])
      for (let i = 0; i < words.length; i++) {
        if (words[i] !== 'از') continue
        const nxt = words[i + 1]
        if (!nxt || analysis.subjectTokens.includes(nxt) || NAME_STOP.has(nxt)) continue
        if (COPULA.has(words[i + 2])) return true
        for (let j = i + 2; j < Math.min(words.length, i + 7); j++) {
          if (SCAN_FUNCTION.has(words[j])) break
          if (ROLE_WORDS.has(words[j])) return true
          if (COPULA.has(words[j])) return true
        }
      }
      if (/written by|authored by/.test(norm)) return true
      if (/\bwrote\b/.test(norm) && /\b[A-Z][a-z]+ [A-Z][a-z]+\b/.test(sentence)) return true
      return /\b[A-Z][a-z]+ [A-Z][a-z]+\b/.test(sentence) &&
        /written|author|wrote/.test(norm)
    }
    case 'place':
      // A-01e2 LIVE FIX: 'قرار' was REMOVED — «در ردیف ششم قرار
      // دارد» (is positioned/ranked sixth) is not a place statement,
      // and it let a Saturn sentence pass as a place answer. 'واقع'
      // (is located) still covers real place sentences.
      return ['پایتخت', 'capital', 'شهر', 'city', 'located', 'واقع', 'situated'].some((t) => toks.has(t))
    case 'date':
      return YEAR_RE.test(norm)
    case 'quantity': {
      if (!/\d/.test(norm)) return false
      return [...toks].some((t) => QUANTITY_UNITS.has(t)) || /[%٪$]/.test(norm) ||
        /\d+\s*(m\/s|km\/s|km\/h)/.test(norm)
    }
    case 'comparative':
      // Strong markers only — weak «پیشرو»/leading is excluded by
      // the same A-01d3 reasoning as the ranking branch.
      return [...toks].some((t) => COMPARATIVE_MARKERS.has(t))
    case 'recent':
      return ['جدیدترین', 'آخرین', 'latest', 'newest', 'recent'].some((t) => toks.has(t)) || YEAR_RE.test(norm)
    case 'definition':
      return analysis.subjectTokens.some((t) => toks.has(t)) &&
        ['است', 'هست', 'می باشد', 'می‌باشد', 'is', 'are'].some((t) => toks.has(t) || norm.includes(t))
    case 'reason': {
      // A-02 (general, from the benchmark's loose-secondary probe):
      // the old explicit-marker rule stays (any چون/زیرا/… counts),
      // PLUS a mechanism shape with no marker at all — the topic
      // itself does something that produces the effect («ماه نور
      // خورشید را منعکس می‌کند») — which counts when a mechanism
      // verb and a subject token are both present in the sentence.
      // The loose-secondary exclusion itself lives in buildAnswer's
      // analysis pass (top-source preference), not here, so this
      // gate never newly rejects a real چون explanation.
      if (['چون', 'زیرا', 'because', 'due', 'علت', 'دلیل'].some((t) => toks.has(t))) return true
      const MECHANISM = ['منعکس', 'بازتاب', 'باعث', 'موجب', 'ایجاد', 'تولید', 'منجر',
        'reflect', 'reflects', 'reflection', 'cause', 'causes', 'caused', 'produce', 'produces']
      return MECHANISM.some((t) => toks.has(t)) && analysis.subjectTokens.some((t) => toks.has(t))
    }
    case 'procedure':
      return ['طریق', 'مراحل', 'steps', 'step', 'روش'].some((t) => toks.has(t))
    case 'enumeration':
      return /،|,/.test(sentence)
  }
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
  // A-01e5 (owner's live failure 2026-11-04: his exact question typed
  // WITHOUT «؟» fell through to 'unknown' and the assistant replied
  // «این فرمان را نمی‌دانم»): two holes are fixed generally, by
  // question TYPE not by this one string — (1) JS \b is ASCII-only,
  // so the old start-anchored test could NEVER match a Persian
  // question word (proven: the same regex matches 'what' but not
  // «کدام»); question words are now matched as whole space-separated
  // tokens ANYWHERE in the input, Persian via lookahead boundaries;
  // (2) a ؟ anywhere (not only at the end) marks a question. Known
  // commands are all matched ABOVE this block, so nothing here can
  // hijack a command — it only rescues questions that used to die.
  const QUESTION_WORD = /(?:^|\s)(?:چیست|کیست|چه|چرا|چگونه|چطور|کی|کجا|کجاست|کدام|چند|چقدر|آیا)(?=\s|$)|(?:^|\s)(?:what|why|how|when|where|who|which|is|are|can|does|do)(?=\s|$)/
  if (/[؟?]/.test(s) || QUESTION_WORD.test(s)) {
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
    // A-02: transcript timestamp fragments ([12:34], [1:02:03],
    // Persian-digit forms) are not content — strip them like [n]
    // references so they never surface inside an answer sentence.
    .replace(/\[[\d۰-۹]{1,2}:[\d۰-۹]{2}(?::[\d۰-۹]{2})?\]/g, '')
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
  // A-01d3: cap at 60 words — a fetched web page's stripped nav
  // (menus, breadcrumbs, footer links) has no sentence terminators,
  // so it collapses into one 100+-word "sentence" that would otherwise
  // win as an answer. Real sentences almost never exceed 60 words.
  countWords(s) >= 5 && countWords(s) <= 60 && !/https?:\/\//.test(s) && !s.includes('==')

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

/** A-01b: the RENDERED page count of an assembled research draft, measured
 *  with the app's OWN pagination engine (computePagination) instead of the
 *  old words/300 estimate — the exact failure found at A-01, where a
 *  713-word sectioned draft was reported as ≈2 pages but rendered as 3.
 *  Why words alone lie: a sectioned draft pays a heading on nearly every
 *  section (large type + browser heading margins) and every paragraph's
 *  last line is only partly filled, so the same word count occupies far
 *  more vertical space than one long unsectioned flow. This function
 *  prices each top-level block the way the editor renders it, then packs
 *  the blocks with computePagination:
 *   - page: the default setup a brand-new document opens with (A4,
 *     Normal margins) via pageSetup's own usableHeightMm/usableWidthMm,
 *     so the estimate and the print @page rule share one usable height;
 *   - type: the editor's own CSS (.a4-page .tiptap: 16px/1.65 body,
 *     h1 2em/1.25, h2 1.5em/1.3, h3 1.2em/1.65; paragraphs .6em below;
 *     headings carry the browser's default block margins);
 *   - lines: characters per line from the usable width at ~0.442em mean
 *     glyph width (calibrated against the live measurements behind
 *     WORDS_PER_PAGE: a 1,024-word unsectioned draft and an 821-word
 *     sectioned draft both render as 3 pages, and this model reproduces
 *     both, while words/300 misses the sectioned case).
 *  Honest limit, stated not hidden: this is a PRE-INSERT estimate — it
 *  assumes the default A4/Normal setup, because the panels do not know
 *  the target document's custom size/margins. Once the draft is inserted,
 *  the editor's measured status-bar count is the truth and supersedes it.
 *  Research assemblies contain only headings and paragraphs; other node
 *  types fall back to body metrics. A block taller than one usable page
 *  is chunked into page-sized pieces (real text flows line by line;
 *  computePagination's oversize rule would otherwise park it on one page). */
const MM_PX = 96 / 25.4 // mirrors Editor.tsx's MM_PX exactly
export function estimateResearchPages(nodes: JsonNode[]): number {
  const setup = {
    sizeId: 'A4' as const, widthMm: PAGE_SIZES.A4.w, heightMm: PAGE_SIZES.A4.h,
    margins: { ...MARGIN_PRESETS.normal }, marginsPreset: 'normal',
  }
  const usablePx = usableHeightMm(setup) * MM_PX
  const usableWidthPx = usableWidthMm(setup) * MM_PX
  const glyph = (fontPx: number) => Math.max(10, Math.floor(usableWidthPx / (fontPx * 0.442)))
  const metrics: Record<string, { fontPx: number; linePx: number; marginPx: number }> = {
    body: { fontPx: 16, linePx: 16 * 1.65, marginPx: 16 * 0.6 },
    h1: { fontPx: 32, linePx: 32 * 1.25, marginPx: 2 * 0.67 * 32 },
    h2: { fontPx: 24, linePx: 24 * 1.3, marginPx: 2 * 0.83 * 24 },
    h3: { fontPx: 19.2, linePx: 19.2 * 1.65, marginPx: 2 * 1.0 * 19.2 },
  }
  const segs: { height: number }[] = []
  for (const node of nodes) {
    const level = (node.attrs as { level?: number } | undefined)?.level
    const m = node.type === 'heading' && level === 1 ? metrics.h1
      : node.type === 'heading' && level === 2 ? metrics.h2
      : node.type === 'heading' ? metrics.h3 : metrics.body
    const text = nodeText(node)
    const lines = Math.max(1, Math.ceil(text.length / glyph(m.fontPx)))
    const height = lines * m.linePx + m.marginPx
    if (height > usablePx) {
      const chunks = Math.ceil(height / usablePx)
      for (let i = 0; i < chunks; i++) segs.push({ height: height / chunks })
    } else {
      segs.push({ height })
    }
  }
  return Math.max(1, computePagination(segs, usablePx).pageCount)
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
  // Light synonyms shared by the A-01c top-source fallback and the
  // A-01d whole-web fallback (defined once, at this scope, so the
  // A-01d2 ranking-preference pass can reuse the web fallback).
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
  const orderedTokens = searchQueryFor(question).split(' ').filter((w) => w.length > 1)
  /** Sentence tokens with ZWNJ-joined words also counted as their
   *  parts, so «قوی‌ترین» matches the question token «قوی». A-01e6:
   *  colloquial glued forms also count — web/transcript text writes
   *  «کدنویسیه» (کدنویسی + ه, the spoken است), which must match the
   *  question token «کدنویسی»; a trailing ه variant is added for
   *  tokens of 4+ chars. */
  const expandedToks = (text: string): Set<string> => {
    const raw = new Set(text.toLowerCase().split(/[^\p{L}\p{N}\u200C]+/u))
    const out = new Set<string>(raw)
    raw.forEach((t) => {
      t.split('\u200C').forEach((p) => { if (p) out.add(p) })
      if (t.length >= 4 && t.endsWith('ه')) out.add(t.slice(0, -1))
    })
    return out
  }
  // A-01e2: the question's analysis, computed once up front so every
  // pass below (ranking, analysis, strict, A-01c, web) can be gated
  // by it. A comparative question's answer must itself state a
  // comparison; place/date/person/quantity questions must be
  // answered by a sentence of their own kind — never by a merely
  // topical paragraph (the A-01e Saturn failure).
  const analysis = analyzeQuestion(question)
  const isComparativeQ = analysis.answerKind === 'comparative'
  const TYPE_GATED_KINDS = new Set<AnswerKind>(['place', 'date', 'name', 'quantity'])
  const isTypeGated = TYPE_GATED_KINDS.has(analysis.answerKind)
  // A-01d3 rank markers, hoisted so the strict and A-01c passes can
  // share the wiki-ranking rule: a strong marker states a ranking
  // on its own; a weak marker («پیشرو»/leading, recency words)
  // describes fields and editions as often as winners, so it counts
  // only with ≥3 question-token matches.
  const STRONG_RANK_MARKERS = new Set([
    'قوی', 'ترین', 'بهترین', 'برتر', 'اول', 'رتبه', 'مقایسه',
    'strongest', 'best', 'top', 'first', 'fastest', 'ranked', 'ranking', 'compare', 'comparison', 'versus',
  ])
  const WEAK_RANK_MARKERS = new Set([
    'پیشرو', 'جدیدترین', 'آخرین',
    'leading', 'newest', 'latest',
  ])
  // A-01e2 LIVE FIX: the weak-marker ≥3 rule counted FUNCTION words
  // as subject matches — the live «کتاب‌های هوش مصنوعی پیشرو…»
  // definition scored 3 via هوش + مصنوعی + در, so a definition won
  // as a "ranking" sentence. Weak markers now need ≥3 CONTENT-token
  // matches (prepositions and function words excluded); strong
  // markers are unchanged.
  const FUNCTION_WORDS = new Set([
    'در', 'از', 'به', 'با', 'برای', 'که', 'و', 'را', 'این', 'آن', 'تا', 'هم', 'نیز',
    'بر', 'بی', 'چون', 'اگر', 'اما', 'یا', 'نه', 'of', 'in', 'on', 'to', 'and', 'the',
  ])
  const hasComparativeSignal = (text: string): boolean => {
    const toks = expandedToks(text)
    // A-01e6: content matches are counted for BOTH marker classes
    // now. A strong marker alone proved too weak an evidence bar:
    // «در روزهای اول…» ("in the first days") carries the strong
    // marker «اول» without ranking anything, and «تر» — the suffix
    // fragment the question tokenizer splits off «قوی‌تر» — is not
    // a subject word, so it never counts as content.
    const contentMatches = [...qTokens].filter((t) => t !== 'تر' && !FUNCTION_WORDS.has(t) && toks.has(t)).length
    if ([...toks].some((t) => STRONG_RANK_MARKERS.has(t))) return contentMatches >= 2
    if (![...toks].some((t) => WEAK_RANK_MARKERS.has(t))) return false
    return contentMatches >= 3
  }
  /** A-01d WHOLE-WEB fallback, as a reusable pass: ONLY
   *  non-Wikipedia sources, in order — a Wikipedia secondary source
   *  can never be rescued by this pass (the France/Korea guard).
   *  The topic token is taken from EACH web source's own title
   *  (else the longest subject token), and the sentence must match
   *  it AND another subject token or a light synonym. A winner or
   *  ranking is stated only when the fetched source's OWN sentence
   *  states it — never invented. At most 2 sentences + that
   *  source's site credit; null when no web source answers. */
  const webFallback = (): string[] | null => {
    for (const ws of sources.filter((s) => !isWikiUrl(s.url))) {
      const wTitleToks = new Set(ws.title.toLowerCase().split(/[^\p{L}\p{N}\u200C]+/u))
      // A-01e6: topic/other matching uses CONTENT tokens only — a
      // function word («در») previously satisfied the "other token"
      // requirement by itself, letting generic sentences through.
      const contentOrdered = orderedTokens.filter((t) => !FUNCTION_WORDS.has(t))
      let wtopic = contentOrdered.filter((t) => wTitleToks.has(t))
      if (wtopic.length === 0) {
        const longest = Math.max(...contentOrdered.map((t) => t.length))
        wtopic = [contentOrdered.find((t) => t.length === longest) as string]
      }
      const wtopicSet = new Set(wtopic)
      const wother = new Set<string>()
      qTokens.forEach((t) => {
        if (!FUNCTION_WORDS.has(t) && !wtopicSet.has(t)) wother.add(t)
        ;(SYNONYMS[t] ?? []).forEach((s) => wother.add(s))
      })
      const wb = cands
        .filter((c) => c.url === ws.url)
        .filter((c) => {
          // A-01e2: type-gated questions need a sentence of their
          // own kind even from a web source — never a topical one.
          if (isTypeGated && !sentenceMatchesQuestionType(c.text, analysis)) return false
          // A-01e6 (live failure 2026-11-04, with the keyed Tavily
          // web leg flowing): a COMPARATIVE question needs a
          // comparative sentence from the web too — the strict and
          // A-01c passes already enforce hasComparativeSignal, but
          // this pass did not, so the first web source's generic
          // opening sentences («دستیارها به تکمیل کد و رفع باگ کمک
          // می‌کنند») won in document order and the answer named no
          // tool at all. Same gate, same rule, no new special case.
          if (isComparativeQ && !hasComparativeSignal(c.text)) return false
          const toks = expandedToks(c.text)
          return wtopic.some((t) => toks.has(t)) && [...wother].some((t) => toks.has(t))
        })
        // Comparative answers take the STRONGEST comparative
        // sentences (score order), not the source's opening lines;
        // every other question kind keeps document order.
        .sort((a, b) => isComparativeQ ? (b.score - a.score || a.order - b.order) : (a.order - b.order))
        .slice(0, 2)
      if (wb.length > 0) {
        const lines = wb.map((c) => c.text)
        lines.push(lang === 'fa' ? `منبع: ${sourceSiteName(ws, lang)} — ${ws.url}` : `Source: ${sourceSiteName(ws, lang)} — ${ws.url}`)
        return lines
      }
    }
    return null
  }
  // Strictness (v2.4, from the live France/Korea failure): when the
  // question names two or more subject words, an answer sentence
  // must match at least TWO of them — matching only a generic word
  // like «پایتخت» in an article about another country is not an
  // answer. Otherwise the honest result is "not found".
  const minScore = qTokens.size >= 2 ? 2 : 1
  // A-01d2 RANKING PREFERENCE (live failure 2026-11-03: the owner's
  // coding-AI question was answered from a generic Wikipedia
  // sentence about Claude, so the web fallback never ran): for
  // ranking/comparison/current questions ONLY, a generic Wikipedia
  // match must not pre-empt the web answer. Order here: (1) a
  // Wikipedia sentence that ITSELF states a comparison/ranking
  // (score ≥ minScore AND a ranking marker) still wins — e.g. the
  // Pacific article stating it is the largest ocean; (2) the web
  // fallback; (3) otherwise fall through to the generic strict pass
  // below, so a question with no web answer keeps its old sourced
  // answer instead of going blank.
  if (isRankingOrCurrentQuestion(question) && qTokens.size >= 2) {
    // A-01d3 (live failure 2026-11-03: the owner's coding-AI question
    // was "answered" by a Wikipedia sentence whose only ranking word
    // was «پیشرو» in «کتاب‌های هوش مصنوعی پیشرو» — leading textbooks,
    // not a ranked winner). The shared hasComparativeSignal rule
    // above owns the strong/weak distinction now.
    const wikiRanking = cands
      .filter((c) => isWikiUrl(c.url) && c.score >= minScore)
      .filter((c) => hasComparativeSignal(c.text))
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .slice(0, 3)
      .sort((a, b) => a.order - b.order)
    if (wikiRanking.length > 0) {
      const lines = wikiRanking.map((c) => c.text)
      for (const url of [...new Set(wikiRanking.map((c) => c.url))].slice(0, 2)) {
        const cand = wikiRanking.find((c) => c.url === url) as Cand
        lines.push(lang === 'fa' ? `منبع: ${sourceSiteName({ url, site: cand.site }, lang)} — ${url}` : `Source: ${sourceSiteName({ url, site: cand.site }, lang)} — ${url}`)
      }
      return { lines, found: true }
    }
    const webLines = webFallback()
    if (webLines) return { lines: webLines, found: true }
  }
  // A-01e QUESTION-ANALYSIS PASS (runs before the generic strict
  // pass, after the ranking branch above): a type-matching sentence
  // that names the question's topic beats a higher-overlap generic
  // sentence that merely shares words. Eligibility mirrors the
  // A-01c guard so the France/Korea case still fails: the sentence
  // must match the global topic (a subject token in the TOP source's
  // title, else the longest subject token) AND another subject token
  // or a light synonym — unless the question has a single subject
  // token, or the answer kind itself carries the evidence (a
  // quantity/date/recent answer's number or year IS the answer).
  // When nothing qualifies, execution falls through to the legacy
  // strict / A-01c / web passes unchanged — never blank by default.
  if (analysis.answerKind !== 'any') {
    const topTitleToks = new Set(sources[0].title.toLowerCase().split(/[^\p{L}\p{N}\u200C]+/u))
    let aTopic = orderedTokens.filter((t) => topTitleToks.has(t))
    if (aTopic.length === 0) {
      const longest = Math.max(...orderedTokens.map((t) => t.length))
      aTopic = [orderedTokens.find((t) => t.length === longest) as string]
    }
    const aTopicSet = new Set(aTopic)
    const aOther = new Set<string>()
    qTokens.forEach((t) => {
      if (!aTopicSet.has(t)) aOther.add(t)
      ;(SYNONYMS[t] ?? []).forEach((s) => aOther.add(s))
    })
    const aRanked = cands
      .filter((c) => {
        if (!sentenceMatchesQuestionType(c.text, analysis)) return false
        const toks = expandedToks(c.text)
        if (!aTopic.some((t) => toks.has(t))) return false
        if (qTokens.size === 1) return true
        if (c.score >= 2) return true
        if ([...aOther].some((t) => toks.has(t))) return true
        return analysis.answerKind === 'quantity' || analysis.answerKind === 'date' || analysis.answerKind === 'recent' || analysis.answerKind === 'reason'
      })
      .sort((a, b) => b.score - a.score || a.order - b.order)
    // A-02 (general, from the benchmark's loose-secondary probe):
    // this pass's topic is defined by the TOP source's title, so
    // when the top source itself has a type-matching sentence, it
    // answers alone — a secondary source's merely topical sentence
    // (high word overlap, different subject) must not ride along
    // and displace or dilute it. When the top source has nothing
    // qualifying, other sources' sentences still answer as before.
    const aFromTop = aRanked.filter((c) => c.url === sources[0].url)
    const aMatched = (aFromTop.length > 0 ? aFromTop : aRanked)
      .slice(0, 2)
      .sort((a, b) => a.order - b.order)
    if (aMatched.length > 0) {
      const lines = aMatched.map((c) => c.text)
      for (const url of [...new Set(aMatched.map((c) => c.url))].slice(0, 2)) {
        const cand = aMatched.find((c) => c.url === url) as Cand
        lines.push(lang === 'fa' ? `منبع: ${sourceSiteName({ url, site: cand.site }, lang)} — ${url}` : `Source: ${sourceSiteName({ url, site: cand.site }, lang)} — ${url}`)
      }
      return { lines, found: true }
    }
  }
  // A-01e2: the strict pass is no longer a generic escape hatch.
  // A comparative question's strict answer must itself state a
  // comparison (the A-01e live regression: a «پیشرو» definition
  // sentence won here after the ranking branch correctly refused
  // it); a type-gated question's strict answer must be a sentence
  // of its own kind — otherwise the chain falls through to A-01c /
  // web / honest not-found instead of serving topical facts.
  const best = cands
    .filter((c) => c.score >= minScore)
    .filter((c) => !isComparativeQ || hasComparativeSignal(c.text))
    .filter((c) => !isTypeGated || sentenceMatchesQuestionType(c.text, analysis))
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
        // A-01e2: the same gates as the strict pass — a comparative
        // question needs a comparative sentence, a type-gated
        // question a sentence of its own kind, even here.
        if (isComparativeQ && !hasComparativeSignal(c.text)) return false
        if (isTypeGated && !sentenceMatchesQuestionType(c.text, analysis)) return false
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
    // A-01d WHOLE-WEB fallback (shared pass, defined above): ONLY
    // non-Wikipedia sources — a Wikipedia secondary source can never
    // be rescued by this pass (the France/Korea guard).
    const webLines = webFallback()
    if (webLines) return { lines: webLines, found: true }
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

// ---- A-01f thinking brain ---------------------------------------------------
// Owner order 2026-11-03 ~22:43 («خیلی مغز متفکر بسازی برایش»): a
// reasoning layer on top of analysis (A-01e) and whole-web search.
// General method only (Hard Rule 9) — no per-question branches:
// (1) DECOMPOSE splits a multi-part question into sub-questions;
// (2) MULTI-STEP SEARCH refines a failed query from the titles that
// came back (max 3 hops, caller-owned); (3) CROSS-CHECK compares
// single-source answers for quantity/date questions and shows a
// disagreement instead of silently picking one number; (4) ASSEMBLY
// orders the parts definition-first and names every unanswered part
// honestly. Nothing here invents a fact: every sentence still comes
// from a source via buildAnswer, with its credit line attached.

const STRICT_TRIGGERS = new Set([
  'چیست', 'کجاست', 'کجا', 'کیست', 'چقدر', 'چند', 'چرا', 'چگونه', 'چطور',
  'چه', 'کدام', 'سالی', 'when', 'where', 'who', 'what', 'how', 'why', 'which',
])

/** Split a multi-part question into its sub-questions. Every part
 *  must carry its own question word — that is what keeps a two-topic
 *  question («پایتخت فرانسه و آلمان چیست؟», first part trigger-less)
 *  whole, while a true two-question ask («پایتخت فرانسه چیست و
 *  جمعیتش چقدر است؟») splits. Anything else returns [question]. */
export function decomposeQuestion(question: string): string[] {
  const raw = question.trim()
  if (!raw) return []
  const pieces = raw
    .split(/\s+و\s+|\s+and\s+|[؛;]|[؟?]\s+(?=\S)/)
    .map((p) => p.trim().replace(/[؟?]+$/, '').trim())
    .filter(Boolean)
  if (pieces.length < 2 || pieces.length > 4) return [raw]
  const ok = pieces.every((p) => {
    const toks = new Set(normalizeCommand(p).replace(/[؟?!.,،؛:«»"“”]/g, '').split(' ').filter(Boolean))
    return toks.size >= 2 && [...toks].some((t) => STRICT_TRIGGERS.has(t))
  })
  return ok ? pieces : [raw]
}

/** Possessive suffixes («جمعیتش» = «جمعیت» + «ش») stripped so a
 *  follow-up part can be matched against the source's own wording.
 *  Only the ش/شان possessive, only on longer tokens — never a
 *  general stemmer, so unrelated words are untouched. */
function stripPossessive(token: string): string {
  if (token.length > 5 && token.endsWith('شان')) return token.slice(0, -3)
  if (token.length > 4 && token.endsWith('ش')) return token.slice(0, -1)
  return token
}

const SUB_QUESTION_CUES = new Set([
  'پایتخت', 'capital', 'نویسنده', 'author', 'مولف', 'سراینده', 'چیست', 'کجاست',
  'کجا', 'کیست', 'چقدر', 'چند', 'چرا', 'چگونه', 'چطور', 'چه', 'کدام', 'سالی',
  'what', 'where', 'who', 'how', 'why', 'when', 'which', 'است', 'هست', 'is', 'are',
])

export interface SubQuestion { question: string; query: string }

/** Effective search question per part. A part that already names its
 *  subject is used as-is; a follow-up part («جمعیتش چقدر است؟»)
 *  inherits the first part's subject noun (its last non-cue token —
 *  «فرانسه» in «پایتخت فرانسه») with possessives stripped, so the
 *  search and the sentence matching see «فرانسه جمعیت چقدر است». */
export function subQuestionQueries(question: string): SubQuestion[] {
  const parts = decomposeQuestion(question)
  if (parts.length === 1) return [{ question: parts[0], query: parts[0] }]
  const firstToks = searchQueryFor(parts[0]).split(' ').filter(Boolean)
  const subjectNoun = [...firstToks].reverse().find((t) => !SUB_QUESTION_CUES.has(t)) ?? firstToks[firstToks.length - 1] ?? ''
  return parts.map((part, i) => {
    if (i === 0) return { question: part, query: part }
    const partToks = searchQueryFor(part).split(' ').filter(Boolean)
    if (subjectNoun && partToks.some((t) => stripPossessive(t) === subjectNoun)) {
      return { question: part, query: part }
    }
    const normalized = part.split(' ').map((t) => stripPossessive(cleanToken(t))).filter(Boolean).join(' ')
    return { question: part, query: subjectNoun ? `${subjectNoun} ${normalized}` : normalized }
  })
}

/** One multi-hop refinement: the original query plus up to two
 *  distinctive title tokens that were not in it yet. Returns the
 *  base query unchanged when the titles add nothing new, so the
 *  caller can stop (max 3 hops total, caller-owned). */
export function refineQuery(question: string, sourceTitles: string[]): string {
  const base = searchQueryFor(question)
  const baseToks = new Set(base.split(' ').filter(Boolean))
  const extra: string[] = []
  for (const title of sourceTitles) {
    for (const rawTok of normalizeCommand(title).split(' ')) {
      const tok = cleanToken(rawTok)
      if (tok.length <= 2 || baseToks.has(tok) || extra.includes(tok)) continue
      if (QUESTION_STOP.has(tok) || RESEARCH_STOP.has(tok)) continue
      extra.push(tok)
      if (extra.length >= 2) break
    }
    if (extra.length >= 2) break
  }
  return extra.length > 0 ? `${base} ${extra.join(' ')}` : base
}

export interface ThoughtPartResult { question: string; lines: string[]; found: boolean }

/** Step-by-step assembly (definition → evidence → conclusion order,
 *  stable within each rank): found parts contribute their own
 *  sentences + credit lines, unanswered parts contribute one honest
 *  line naming the part, never a guessed answer. Duplicate sentences
 *  are kept once. No part found at all → found false, no lines. */
export function assembleThoughtAnswer(parts: ThoughtPartResult[], lang: 'fa' | 'en'): { lines: string[]; found: boolean } {
  if (parts.length === 0) return { lines: [], found: false }
  if (parts.length === 1) return { lines: parts[0].lines, found: parts[0].found }
  const rank = (q: string): number => {
    const t = analyzeQuestion(q).type
    if (t === 'definition') return 0
    if (t === 'place' || t === 'person' || t === 'date' || t === 'quantity') return 1
    if (t === 'why' || t === 'how') return 2
    if (t === 'enumeration' || t === 'ranking' || t === 'current') return 3
    return 4
  }
  const ordered = parts.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p.question) - rank(b.p.question) || a.i - b.i)
  const lines: string[] = []
  const seen = new Set<string>()
  let anyFound = false
  for (const { p } of ordered) {
    if (p.found) {
      anyFound = true
      for (const line of p.lines) {
        if (line.startsWith('منبع:') || line.startsWith('Source:')) { lines.push(line); continue }
        if (seen.has(line)) continue
        seen.add(line)
        lines.push(line)
      }
    } else {
      lines.push(lang === 'fa'
        ? `برای این بخش پاسخی در منابع پیدا نشد: ${p.question}`
        : `No answer was found in the sources for this part: ${p.question}`)
    }
  }
  return anyFound ? { lines, found: true } : { lines: [], found: false }
}

/** Cross-check for quantity/date questions: answer the question from
 *  EACH source alone, and if two independent sources both answer but
 *  with different numbers (same measured unit), return a disagreement
 *  block with both sentences and both credits instead of silently
 *  picking one. Equal numbers, a single source, or no pair of
 *  answers → null (the merged answer stands). */
export function findNumericConflict(
  sources: ResearchData[],
  question: string,
  lang: 'fa' | 'en',
): string[] | null {
  const analysis = analyzeQuestion(question)
  if (analysis.answerKind !== 'quantity' && analysis.answerKind !== 'date') return null
  if (sources.length < 2) return null
  // Numbers are normalized to a common scale first, so «۶۸
  // میلیون» and «68,000,000» agree instead of falsely conflicting.
  const readNumber = (sentence: string): number | null => {
    const norm = normalizeDigits(sentence)
    const m = norm.match(/(\d[\d.,]*)\s*(میلیون|میلیارد|هزار|million|billion|thousand)?/)
    if (!m) return null
    const value = parseFloat(m[1].replace(/,/g, ''))
    if (!Number.isFinite(value)) return null
    const scale: Record<string, number> = { 'میلیون': 1e6, million: 1e6, 'میلیارد': 1e9, billion: 1e9, 'هزار': 1e3, thousand: 1e3 }
    return value * (m[2] ? (scale[m[2]] ?? 1) : 1)
  }
  const answers: { sentence: string; credit: string; value: number }[] = []
  for (const src of sources) {
    const one = buildAnswer([src], question, lang)
    if (!one.found) continue
    const sentence = one.lines.find((l) => !l.startsWith('منبع:') && !l.startsWith('Source:'))
    const credit = one.lines.find((l) => l.startsWith('منبع:') || l.startsWith('Source:'))
    if (!sentence || !credit) continue
    const num = readNumber(sentence)
    if (num === null) continue
    answers.push({ sentence, credit, value: num })
  }
  for (let i = 0; i < answers.length; i++) {
    for (let j = i + 1; j < answers.length; j++) {
      if (answers[i].value !== answers[j].value) {
        return [
          lang === 'fa'
            ? 'منابع در این عدد با هم اختلاف دارند — هر دو را ببینید:'
            : 'Sources disagree on this number — both are shown:',
          answers[i].sentence, answers[i].credit,
          answers[j].sentence, answers[j].credit,
        ]
      }
    }
  }
  return null
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
