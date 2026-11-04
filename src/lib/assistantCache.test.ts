// A-10 panel-session cache tests: key normalization, hit/miss,
// copy isolation, FIFO cap, and the never-cache-empty rule.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  normalizeCacheQuery, assistantCacheKey,
  getCachedAssistantSources, setCachedAssistantSources,
  clearAssistantCache, assistantCacheSize, ASSISTANT_CACHE_MAX,
} from './assistantCache'
import type { ResearchData } from './assistant'

const src = (title: string): ResearchData => ({ title, extract: `${title} extract`, url: `https://example.com/${title}` })

beforeEach(() => clearAssistantCache())

describe('A-10 cache key normalization', () => {
  it('folds case, spacing and a trailing question mark', () => {
    expect(normalizeCacheQuery('  Capital   OF France؟ ')).toBe('capital of france')
    expect(assistantCacheKey({ query: 'پایتخت فرانسه چیست؟', lang: 'fa', mode: 'answer' }))
      .toBe(assistantCacheKey({ query: 'پایتخت فرانسه چیست', lang: 'fa', mode: 'answer' }))
  })
  it('separates answer from research, language, and research pages', () => {
    const a = assistantCacheKey({ query: 'france', lang: 'fa', mode: 'answer' })
    const r = assistantCacheKey({ query: 'france', lang: 'fa', pages: 1 })
    const r2 = assistantCacheKey({ query: 'france', lang: 'fa', pages: 2 })
    const en = assistantCacheKey({ query: 'france', lang: 'en', mode: 'answer' })
    expect(new Set([a, r, r2, en]).size).toBe(4)
  })
})

describe('A-10 cache store and read', () => {
  it('misses before store, hits after, and copies isolate the entry', () => {
    const key = assistantCacheKey({ query: 'france', lang: 'fa', mode: 'answer' })
    expect(getCachedAssistantSources(key)).toBeNull()
    const stored = [src('France')]
    setCachedAssistantSources(key, stored)
    stored[0].title = 'Mutated'
    const hit = getCachedAssistantSources(key)
    expect(hit?.[0].title).toBe('France')
    hit![0].title = 'Mutated again'
    expect(getCachedAssistantSources(key)?.[0].title).toBe('France')
  })
  it('never stores an empty source list', () => {
    const key = assistantCacheKey({ query: 'nothing', lang: 'fa', mode: 'answer' })
    setCachedAssistantSources(key, [])
    expect(getCachedAssistantSources(key)).toBeNull()
    expect(assistantCacheSize()).toBe(0)
  })
  it('evicts the oldest entry past the cap', () => {
    for (let i = 0; i < ASSISTANT_CACHE_MAX + 1; i++) {
      setCachedAssistantSources(assistantCacheKey({ query: `topic ${i}`, lang: 'fa', mode: 'answer' }), [src(`T${i}`)])
    }
    expect(assistantCacheSize()).toBe(ASSISTANT_CACHE_MAX)
    expect(getCachedAssistantSources(assistantCacheKey({ query: 'topic 0', lang: 'fa', mode: 'answer' }))).toBeNull()
    expect(getCachedAssistantSources(assistantCacheKey({ query: `topic ${ASSISTANT_CACHE_MAX}`, lang: 'fa', mode: 'answer' }))?.[0].title)
      .toBe(`T${ASSISTANT_CACHE_MAX}`)
  })
})
