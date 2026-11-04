// A-10 speed: a panel-session cache for assistant searches.
//
// A repeated question or research topic in the same page session
// replays its sources from memory instead of calling assistant-search
// again — the function call is the slow leg (search engines +
// page fetches), while the local answer assembly is instant.
// Session-only by design: a plain module Map, never localStorage,
// so nothing about what the user asked survives the page session,
// failed/not-found searches are never cached (a later retry may
// succeed when a source comes back), and only successful source
// lists are stored. The cache is shared by both assistant homes
// (Agent page + Review-tab panel), so asking in one place and
// re-asking in the other is instant too. FIFO cap keeps memory
// bounded; sources are copied on store and on read so a caller
// mutating its list cannot corrupt the cached copy.
import type { ResearchData } from './assistant'

export const ASSISTANT_CACHE_MAX = 40

export type AssistantCacheBody = {
  query: string
  lang: string
  pages?: number
  mode?: 'answer' | 'research'
}

// Normalize so the same question asked with different casing,
// spacing or a trailing question mark hits the same entry. Latin
// letters fold to lower case; Persian/Arabic letters have no case.
// Trailing ؟/? and surrounding punctuation never change the topic.
export function normalizeCacheQuery(query: string): string {
  return query
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[؟?]+$/g, '')
    .trim()
    .toLowerCase()
}

export function assistantCacheKey(body: AssistantCacheBody): string {
  const mode = body.mode ?? 'research'
  const pages = mode === 'research' ? Math.max(1, Math.floor(body.pages ?? 1)) : 1
  return `${mode}|${body.lang}|${pages}|${normalizeCacheQuery(body.query)}`
}

const cache = new Map<string, ResearchData[]>()

export function getCachedAssistantSources(key: string): ResearchData[] | null {
  const hit = cache.get(key)
  return hit ? hit.map((s) => ({ ...s })) : null
}

export function setCachedAssistantSources(key: string, sources: ResearchData[]): void {
  if (sources.length === 0) return
  cache.set(key, sources.map((s) => ({ ...s })))
  while (cache.size > ASSISTANT_CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

export function clearAssistantCache(): void {
  cache.clear()
}

// Test seam: how many entries the session cache currently holds.
export function assistantCacheSize(): number {
  return cache.size
}
