// Empty states & first-use onboarding guide (Mission 2, M2-16 = owner spec §19).
// Local Mode only: dismissal is stored in the browser's own storage, never
// uploaded, and no account is required for any of this. Every helper tolerates
// missing or blocked storage (try/catch, never throws) so a private-mode
// browser degrades to "guide shown again next visit" instead of crashing.

export const ONBOARDING_KEY = 'vyro-web-onboarding-v1'

// The value written on dismissal. Anything else in the slot (empty, garbage,
// an older format) is treated as NOT dismissed — a corrupt value must never
// hide the guide permanently, nor crash the dashboard.
const DISMISSED_VALUE = 'dismissed'

export function isOnboardingDismissed(storage: Pick<Storage, 'getItem'>): boolean {
  try {
    return storage.getItem(ONBOARDING_KEY) === DISMISSED_VALUE
  } catch {
    return false
  }
}

// Persists a dismissal. Returns false (instead of throwing) when storage is
// blocked; the caller still hides the guide for this visit.
export function dismissOnboarding(storage: Pick<Storage, 'setItem'>): boolean {
  try {
    storage.setItem(ONBOARDING_KEY, DISMISSED_VALUE)
    return true
  } catch {
    return false
  }
}

// Clears a stored dismissal so the guide shows again ("Show guide again").
// Returns false (instead of throwing) when storage is blocked.
export function restoreOnboarding(storage: Pick<Storage, 'removeItem'>): boolean {
  try {
    storage.removeItem(ONBOARDING_KEY)
    return true
  } catch {
    return false
  }
}

export type DashboardEmptyState = 'none' | 'no-documents' | 'no-matches' | 'folder-empty'

// Classifies the dashboard's document list for its empty message.
// Precedence is deliberate and pinned by tests:
//  - a non-empty list is never an empty state, whatever the filters say;
//  - zero live documents beats every filter (filters are meaningless then);
//  - an active folder filter gets its own message, even when a search query
//    is also active (the folder is the narrower, more actionable cause);
//  - everything else with an empty list is a generic search/filter no-match.
// Trash is NOT classified here — App already renders its own trash empty state.
export function classifyDashboardEmptyState(input: {
  liveCount: number
  filteredCount: number
  folder: string
  query: string
}): DashboardEmptyState {
  if (input.filteredCount > 0) return 'none'
  if (input.liveCount <= 0) return 'no-documents'
  if (input.folder.trim() !== '') return 'folder-empty'
  return 'no-matches'
}
