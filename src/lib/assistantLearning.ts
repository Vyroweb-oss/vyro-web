// A-01g — LEARNING FROM USERS (owner order 2026-11-03 ~22:49:
// «طوری آموزش بتی که وقتی با کاربران سوال جواب میکند یاد بگیرد طرز
// رفتار کردن را با دیگران»). The assistant improves from real use,
// entirely ON THIS DEVICE: feedback, weak questions, language mix
// and conversational behaviour are kept in localStorage only.
// NOTHING here ever leaves the device automatically — no network,
// no document text, no question text sent anywhere (hard
// per-document consent rules unchanged, no DB schema change).
// This module is pure + storage-injectable so every rule is unit-
// testable without a browser.

export type StoreLike = {
  getItem: (k: string) => string | null
  setItem: (k: string, v: string) => void
}

export const FEEDBACK_KEY = 'vyro-web-assistant-feedback-v1'
export const WEAK_KEY = 'vyro-web-assistant-weak-v1'
export const LANG_HISTORY_KEY = 'vyro-web-assistant-lang-v1'

export type FeedbackRecord = { q: string; useful: boolean; words: number; ts: number }
export type WeakReason = 'not-found' | 'generic'
export type WeakEntry = { q: string; reason: WeakReason; ts: number }
export type DetailPreference = 'short' | 'balanced' | 'detailed'
export type ReplyLang = 'fa' | 'en'
export type SocialKind = 'greeting' | 'thanks'

const FEEDBACK_CAP = 50
const WEAK_CAP = 20
const LANG_CAP = 30

function safeStore(): StoreLike | null {
  try {
    const ls = (globalThis as { localStorage?: StoreLike }).localStorage
    if (!ls) return null
    return ls
  } catch {
    return null
  }
}

function readJson<T>(store: StoreLike | null | undefined, key: string, fallback: T): T {
  const s = store ?? safeStore()
  if (!s) return fallback
  try {
    const raw = s.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as T
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

function writeJson(store: StoreLike | null | undefined, key: string, value: unknown): void {
  const s = store ?? safeStore()
  if (!s) return
  try {
    s.setItem(key, JSON.stringify(value))
  } catch {
    // Blocked storage (private mode, quota) must never break answering.
  }
}

function normQuestion(q: string): string {
  return q.trim().replace(/[\s\u200c]+/g, ' ').replace(/[؟?]+$/g, '').trim()
}

// ---------- (1) FEEDBACK: «مفید بود / نبود» tilts future length ----------

export function recordFeedback(
  question: string, useful: boolean, answerWords: number, store?: StoreLike | null,
): void {
  const q = normQuestion(question)
  if (!q) return
  const all = readJson<FeedbackRecord[]>(store, FEEDBACK_KEY, [])
  const list = Array.isArray(all) ? all : []
  list.push({ q, useful, words: Math.max(0, Math.floor(answerWords)), ts: Date.now() })
  writeJson(store, FEEDBACK_KEY, list.slice(-FEEDBACK_CAP))
}

export function getFeedback(store?: StoreLike | null): FeedbackRecord[] {
  const all = readJson<FeedbackRecord[]>(store, FEEDBACK_KEY, [])
  return Array.isArray(all) ? all : []
}

// General rule, not per-question memory: when the answers a user
// marked USEFUL are clearly shorter than the ones marked NOT USEFUL,
// future answers are trimmed; when useful answers are clearly
// longer, full detail is kept. Anything else stays balanced.
export function feedbackPreference(store?: StoreLike | null): DetailPreference {
  const recent = getFeedback(store).slice(-20)
  const useful = recent.filter((r) => r.useful)
  const notUseful = recent.filter((r) => !r.useful)
  if (useful.length === 0 || notUseful.length === 0 || recent.length < 3) return 'balanced'
  const avg = (rs: FeedbackRecord[]) => rs.reduce((a, r) => a + r.words, 0) / rs.length
  const u = avg(useful)
  const n = avg(notUseful)
  if (u < n * 0.8) return 'short'
  if (u > n * 1.25) return 'detailed'
  return 'balanced'
}

export function isCreditLine(line: string): boolean {
  return line.startsWith('منبع:') || line.startsWith('Source:')
}

export function countAnswerWords(lines: string[]): number {
  return lines.join(' ').split(/\s+/).filter(Boolean).length
}

// 'short' keeps the first answer sentence PLUS every source-credit
// line — trimming must never drop the credit (hard rule 2).
export function applyDetailPreference(lines: string[], pref: DetailPreference): string[] {
  if (pref !== 'short') return lines
  const credit = lines.filter(isCreditLine)
  const body = lines.filter((l) => !isCreditLine(l))
  if (body.length === 0) return lines
  return [body[0], ...credit]
}

// ---------- (2) FAILURE MINING: local weak-question list ----------

export function recordWeakQuestion(
  question: string, reason: WeakReason, store?: StoreLike | null,
): void {
  const q = normQuestion(question)
  if (!q) return
  const all = readJson<WeakEntry[]>(store, WEAK_KEY, [])
  const list = (Array.isArray(all) ? all : []).filter((e) => normQuestion(e.q) !== q)
  list.push({ q, reason, ts: Date.now() })
  writeJson(store, WEAK_KEY, list.slice(-WEAK_CAP))
}

export function getWeakQuestions(store?: StoreLike | null): WeakEntry[] {
  const all = readJson<WeakEntry[]>(store, WEAK_KEY, [])
  return Array.isArray(all) ? all : []
}

export function clearWeakQuestions(store?: StoreLike | null): void {
  writeJson(store, WEAK_KEY, [])
}

// ---------- (3) BEHAVIOUR: language, social replies, clarification ----------

export function detectUserLanguage(input: string): ReplyLang | null {
  if (/[\u0600-\u06FF]/.test(input)) return 'fa'
  if (/[A-Za-z]/.test(input)) return 'en'
  return null
}

export function recordUserLanguage(input: string, store?: StoreLike | null): void {
  const lang = detectUserLanguage(input)
  if (!lang) return
  const all = readJson<ReplyLang[]>(store, LANG_HISTORY_KEY, [])
  const list = (Array.isArray(all) ? all : []).filter((l) => l === 'fa' || l === 'en')
  list.push(lang)
  writeJson(store, LANG_HISTORY_KEY, list.slice(-LANG_CAP))
}

// The user's own current wording wins; otherwise their recent
// history on this device; otherwise null (caller falls back to UI lang).
export function preferredReplyLanguage(input: string, store?: StoreLike | null): ReplyLang | null {
  const direct = detectUserLanguage(input)
  if (direct) return direct
  const hist = readJson<ReplyLang[]>(store, LANG_HISTORY_KEY, [])
  const list = (Array.isArray(hist) ? hist : []).filter((l) => l === 'fa' || l === 'en')
  if (list.length === 0) return null
  const fa = list.filter((l) => l === 'fa').length
  return fa * 2 >= list.length ? 'fa' : 'en'
}

const FA_GREET = new Set(['سلام', 'درود', 'صبح', 'عصر', 'شب'])
const FA_GREET_PHRASE = ['صبح بخیر', 'عصر بخیر', 'شب بخیر']
const FA_THANKS = new Set(['ممنون', 'تشکر', 'مرسی', 'سپاس', 'سپاسگزارم', 'متشکرم'])
const EN_GREET = new Set(['hi', 'hello', 'hey'])
const EN_GREET_PHRASE = ['good morning', 'good afternoon', 'good evening']
const EN_THANKS = new Set(['thanks', 'thank'])

// Purely social input only: after removing greeting/thanks words
// nothing may remain, and a question word anywhere vetoes it —
// «سلام، پایتخت فرانسه کجاست؟» is a question, not a greeting.
export function detectSocial(input: string): SocialKind | null {
  const raw = input.trim().toLowerCase()
  if (!raw || raw.length > 60) return null
  if (/[؟?]/.test(raw)) return null
  const stripped = raw.replace(/[!,،.؛:]/g, ' ')
  for (const phrase of [...FA_GREET_PHRASE, ...EN_GREET_PHRASE]) {
    if (stripped.includes(phrase)) {
      const rest = stripped.replace(phrase, ' ').split(/[\s\u200c]+/).filter(Boolean)
      if (rest.length === 0) return 'greeting'
    }
  }
  for (const phrase of ['thank you', 'thanks a lot']) {
    if (stripped.includes(phrase)) {
      const rest = stripped.replace(phrase, ' ').split(/[\s\u200c]+/).filter(Boolean)
      if (rest.length === 0) return 'thanks'
    }
  }
  const tokens = stripped.split(/[\s\u200c]+/).filter(Boolean)
  if (tokens.length === 0 || tokens.length > 5) return null
  const hasThanks = tokens.some((t) => FA_THANKS.has(t) || EN_THANKS.has(t))
  const hasGreet = tokens.some((t) => FA_GREET.has(t) || EN_GREET.has(t))
  if (!hasThanks && !hasGreet) return null
  const rest = tokens.filter((t) => !FA_GREET.has(t) && !FA_THANKS.has(t) && !EN_GREET.has(t) && !EN_THANKS.has(t))
  if (rest.length > 0) return null
  return hasThanks ? 'thanks' : 'greeting'
}

const QUESTION_WORDS = new Set([
  'کیست', 'چیست', 'چه', 'چرا', 'چگونه', 'چطور', 'کی', 'کجا', 'کجاست', 'کدام', 'چند', 'چقدر', 'آیا',
  'who', 'what', 'where', 'when', 'why', 'how', 'which', 'whose', 'is', 'are',
])
const PRONOUNS = new Set([
  'او', 'وی', 'ایشان', 'این', 'آن', 'اینها', 'آنها', 'خودش', 'همین', 'همان',
  'he', 'she', 'it', 'they', 'him', 'her', 'this', 'that', 'these', 'those',
])

// An ambiguous question names NO subject — only a pronoun /
// demonstrative («او کیست؟», «این چیست؟», 'who is he?') — or no
// subject at all. With a prior answered topic it is a follow-up,
// not ambiguous. Guessing an answer here would be inventing one.
export function isAmbiguousQuestion(input: string, lastTopic?: string | null): boolean {
  if (lastTopic && lastTopic.trim().length > 0) return false
  const stripped = input.trim().toLowerCase().replace(/[؟?!,،.؛:]/g, ' ')
  const tokens = stripped.split(/[\s\u200c]+/).filter(Boolean)
  if (tokens.length === 0) return false
  const isQuestion = /[؟?]/.test(input) || tokens.some((t) => QUESTION_WORDS.has(t))
  if (!isQuestion) return false
  const content = tokens.filter((t) => !QUESTION_WORDS.has(t))
  if (content.length === 0) return true
  return content.every((t) => PRONOUNS.has(t))
}
