// A-01g learning-from-users tests: feedback tilts length, weak
// questions are mined locally, social/ambiguous/language behaviour.
// All storage is an in-memory fake — nothing touches a real device
// store and nothing here ever performs network I/O.
import { describe, it, expect } from 'vitest'
import {
  recordFeedback, getFeedback, feedbackPreference,
  applyDetailPreference, countAnswerWords,
  recordWeakQuestion, getWeakQuestions, clearWeakQuestions,
  detectSocial, isAmbiguousQuestion,
  detectUserLanguage, recordUserLanguage, preferredReplyLanguage,
  type StoreLike,
} from './assistantLearning'

function memoryStore(): StoreLike {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, v) },
  }
}

describe('A-01g feedback persists and tilts future answer length', () => {
  it('records feedback and reads it back', () => {
    const s = memoryStore()
    recordFeedback('پایتخت فرانسه کجاست؟', true, 40, s)
    expect(getFeedback(s)).toHaveLength(1)
    expect(getFeedback(s)[0].useful).toBe(true)
  })
  it('short useful + long not-useful answers tilt to short', () => {
    const s = memoryStore()
    recordFeedback('q1', true, 20, s)
    recordFeedback('q2', true, 25, s)
    recordFeedback('q3', false, 200, s)
    recordFeedback('q4', false, 180, s)
    expect(feedbackPreference(s)).toBe('short')
  })
  it('long useful + short not-useful answers tilt to detailed', () => {
    const s = memoryStore()
    recordFeedback('q1', true, 200, s)
    recordFeedback('q2', true, 180, s)
    recordFeedback('q3', false, 20, s)
    expect(feedbackPreference(s)).toBe('detailed')
  })
  it('too little or one-sided feedback stays balanced', () => {
    const s = memoryStore()
    expect(feedbackPreference(s)).toBe('balanced')
    recordFeedback('q1', true, 20, s)
    recordFeedback('q2', true, 25, s)
    expect(feedbackPreference(s)).toBe('balanced')
  })
  it('short preference keeps the first sentence AND the source credit', () => {
    const lines = ['پاریس پایتخت فرانسه است.', 'فرانسه کشوری در اروپاست.', 'منبع: ویکی‌پدیا — https://example.org/fr']
    const trimmed = applyDetailPreference(lines, 'short')
    expect(trimmed).toEqual(['پاریس پایتخت فرانسه است.', 'منبع: ویکی‌پدیا — https://example.org/fr'])
    expect(countAnswerWords(lines)).toBeGreaterThan(countAnswerWords(trimmed))
  })
  it('balanced/detailed leave answers untouched', () => {
    const lines = ['a b.', 'c d.', 'Source: X — https://example.org']
    expect(applyDetailPreference(lines, 'balanced')).toEqual(lines)
    expect(applyDetailPreference(lines, 'detailed')).toEqual(lines)
  })
  it('blocked storage never throws', () => {
    const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    expect(() => recordFeedback('q', true, 10, broken)).not.toThrow()
    expect(feedbackPreference(broken)).toBe('balanced')
    expect(getWeakQuestions(broken)).toEqual([])
  })
})

describe('A-01g local weak-question list', () => {
  it('a failed question lands in the weak list', () => {
    const s = memoryStore()
    recordWeakQuestion('پایتخت سیاره زحل کجاست؟', 'not-found', s)
    expect(getWeakQuestions(s).map((e) => e.q)).toContain('پایتخت سیاره زحل کجاست')
    expect(getWeakQuestions(s)[0].reason).toBe('not-found')
  })
  it('the same question is stored once, newest reason wins', () => {
    const s = memoryStore()
    recordWeakQuestion('q?', 'not-found', s)
    recordWeakQuestion('q?', 'generic', s)
    expect(getWeakQuestions(s)).toHaveLength(1)
    expect(getWeakQuestions(s)[0].reason).toBe('generic')
  })
  it('the list is capped, oldest entries drop first', () => {
    const s = memoryStore()
    for (let i = 0; i < 25; i++) recordWeakQuestion(`q${i}`, 'not-found', s)
    const list = getWeakQuestions(s)
    expect(list).toHaveLength(20)
    expect(list.map((e) => e.q)).not.toContain('q0')
    expect(list.map((e) => e.q)).toContain('q24')
  })
  it('clear empties the list', () => {
    const s = memoryStore()
    recordWeakQuestion('q', 'not-found', s)
    clearWeakQuestions(s)
    expect(getWeakQuestions(s)).toEqual([])
  })
})

describe('A-01g conversational behaviour', () => {
  it('greetings and thanks are answered socially, not searched', () => {
    expect(detectSocial('سلام')).toBe('greeting')
    expect(detectSocial('درود')).toBe('greeting')
    expect(detectSocial('صبح بخیر')).toBe('greeting')
    expect(detectSocial('hello')).toBe('greeting')
    expect(detectSocial('ممنون')).toBe('thanks')
    expect(detectSocial('thank you')).toBe('thanks')
    expect(detectSocial('تشکر')).toBe('thanks')
  })
  it('a greeting attached to a real question is NOT social', () => {
    expect(detectSocial('سلام، پایتخت فرانسه کجاست؟')).toBe(null)
    expect(detectSocial('پایتخت فرانسه کجاست؟')).toBe(null)
    expect(detectSocial('جدول ۳×۴ بساز')).toBe(null)
  })
  it('a pronoun-only question with no subject asks for clarification', () => {
    expect(isAmbiguousQuestion('او کیست؟')).toBe(true)
    expect(isAmbiguousQuestion('این چیست؟')).toBe(true)
    expect(isAmbiguousQuestion('who is he?')).toBe(true)
    expect(isAmbiguousQuestion('کیست؟')).toBe(true)
  })
  it('a named question is not ambiguous, and a follow-up resolves against its topic', () => {
    expect(isAmbiguousQuestion('مولانا کیست؟')).toBe(false)
    expect(isAmbiguousQuestion('پایتخت فرانسه کجاست؟')).toBe(false)
    expect(isAmbiguousQuestion('او کیست؟', 'مولانا کیست؟')).toBe(false)
  })
  it('a Dari-speaking user is detected as Dari, English as English', () => {
    expect(detectUserLanguage('پایتخت فرانسه کجاست؟')).toBe('fa')
    expect(detectUserLanguage('what is the capital of France?')).toBe('en')
    expect(detectUserLanguage('12345')).toBe(null)
  })
  it('a Dari follow-up is answered in Dari even after English history', () => {
    const s = memoryStore()
    recordUserLanguage('what is the capital of France?', s)
    recordUserLanguage('who wrote Hamlet?', s)
    expect(preferredReplyLanguage('پایتخت فرانسه کجاست؟', s)).toBe('fa')
    expect(preferredReplyLanguage('where is Paris?', s)).toBe('en')
    expect(preferredReplyLanguage('123', s)).toBe('en')
  })
})
