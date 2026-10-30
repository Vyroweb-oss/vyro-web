import { describe, it, expect } from 'vitest'
import {
  ONBOARDING_KEY, isOnboardingDismissed, dismissOnboarding, restoreOnboarding,
  classifyDashboardEmptyState,
} from './onboarding'

function fakeStorage(initial?: Record<string, string>) {
  const m = new Map<string, string>(Object.entries(initial ?? {}))
  return {
    map: m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v) },
    removeItem: (k: string) => { m.delete(k) },
  }
}

function blockedStorage() {
  const boom = () => { throw new Error('storage blocked') }
  return { getItem: boom, setItem: boom, removeItem: boom }
}

describe('onboarding dismissal storage', () => {
  it('defaults to not dismissed when nothing is stored', () => {
    expect(isOnboardingDismissed(fakeStorage())).toBe(false)
  })
  it('dismiss persists and reload reads it back', () => {
    const s = fakeStorage()
    expect(dismissOnboarding(s)).toBe(true)
    expect(s.map.get(ONBOARDING_KEY)).toBe('dismissed')
    expect(isOnboardingDismissed(s)).toBe(true)
  })
  it('a corrupt stored value is treated as not dismissed', () => {
    for (const bad of ['1', 'true', 'yes', '{"dismissed":true}', '']) {
      expect(isOnboardingDismissed(fakeStorage({ [ONBOARDING_KEY]: bad }))).toBe(false)
    }
  })
  it('blocked storage never throws and reports not dismissed / failure', () => {
    const s = blockedStorage()
    expect(() => isOnboardingDismissed(s)).not.toThrow()
    expect(isOnboardingDismissed(s)).toBe(false)
    expect(() => dismissOnboarding(s)).not.toThrow()
    expect(dismissOnboarding(s)).toBe(false)
    expect(() => restoreOnboarding(s)).not.toThrow()
    expect(restoreOnboarding(s)).toBe(false)
  })
  it('restore clears a dismissal so the guide shows again', () => {
    const s = fakeStorage()
    dismissOnboarding(s)
    expect(isOnboardingDismissed(s)).toBe(true)
    expect(restoreOnboarding(s)).toBe(true)
    expect(isOnboardingDismissed(s)).toBe(false)
  })
})

describe('classifyDashboardEmptyState', () => {
  it('non-empty list is never an empty state, even with filters active', () => {
    expect(classifyDashboardEmptyState({ liveCount: 3, filteredCount: 2, folder: 'Work', query: 'x' })).toBe('none')
  })
  it('zero live documents is no-documents, even with filters active', () => {
    expect(classifyDashboardEmptyState({ liveCount: 0, filteredCount: 0, folder: 'Work', query: 'x' })).toBe('no-documents')
    expect(classifyDashboardEmptyState({ liveCount: 0, filteredCount: 0, folder: '', query: '' })).toBe('no-documents')
  })
  it('folder filter active with docs existing is folder-empty', () => {
    expect(classifyDashboardEmptyState({ liveCount: 4, filteredCount: 0, folder: 'Work', query: '' })).toBe('folder-empty')
  })
  it('folder + query together still classify as folder-empty (folder wins)', () => {
    expect(classifyDashboardEmptyState({ liveCount: 4, filteredCount: 0, folder: 'Work', query: 'report' })).toBe('folder-empty')
  })
  it('query only (no folder) is a generic no-matches', () => {
    expect(classifyDashboardEmptyState({ liveCount: 4, filteredCount: 0, folder: '', query: 'zzz' })).toBe('no-matches')
  })
  it('filters with no query and no folder (e.g. favorites only) are no-matches', () => {
    expect(classifyDashboardEmptyState({ liveCount: 4, filteredCount: 0, folder: '', query: '' })).toBe('no-matches')
  })
  it('a whitespace-only folder counts as no folder filter', () => {
    expect(classifyDashboardEmptyState({ liveCount: 4, filteredCount: 0, folder: '   ', query: 'zzz' })).toBe('no-matches')
  })
})
