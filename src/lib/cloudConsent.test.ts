import { describe, it, expect } from 'vitest'
import { loadConsent, recordConsent, CLOUD_CONSENT_KEY } from './cloudConsent'

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, v) },
  }
}

describe('cloud consent (Stage 0 §5.2 — per account, local record)', () => {
  it('no record means no consent', () => {
    expect(loadConsent(fakeStorage(), 'acct-a')).toBeNull()
  })

  it('records and reads back a timestamp for the same account', () => {
    const s = fakeStorage()
    const at = new Date('2026-11-01T17:00:00.000Z')
    expect(recordConsent(s, 'acct-a', at)).toBe(true)
    expect(loadConsent(s, 'acct-a')).toBe('2026-11-01T17:00:00.000Z')
  })

  it('consent is per-account: another account has none', () => {
    const s = fakeStorage()
    recordConsent(s, 'acct-a')
    expect(loadConsent(s, 'acct-b')).toBeNull()
  })

  it('a corrupt stored value reads as no consent (safe direction)', () => {
    const s = fakeStorage({ [CLOUD_CONSENT_KEY]: '{{{not json' })
    expect(loadConsent(s, 'acct-a')).toBeNull()
    const s2 = fakeStorage({ [CLOUD_CONSENT_KEY]: JSON.stringify({ 'acct-a': 'not-a-date' }) })
    expect(loadConsent(s2, 'acct-a')).toBeNull()
  })

  it('an empty account id never has and never records consent', () => {
    const s = fakeStorage()
    expect(recordConsent(s, '')).toBe(false)
    expect(loadConsent(s, '')).toBeNull()
  })

  it('a storage that throws on write reports failure instead of assuming consent', () => {
    const s = {
      getItem: () => null,
      setItem: () => { throw new Error('quota') },
    }
    expect(recordConsent(s, 'acct-a')).toBe(false)
  })
})
