// Title-bar rename rules (TITLE BAR REDESIGN mission, owner spec §5).
// Pure functions — no storage, no DOM. The editor title input keeps a
// local draft while editing; Enter/blur commits through here, Escape
// discards the draft. A commit can never produce an empty title: an
// empty or whitespace-only draft reverts to the current title, and an
// unchanged draft is reported as no change so no save is triggered.

export const TITLE_MAX_LENGTH = 200

export interface TitleCommit {
  /** The title to keep after the edit ends (the old title on a revert). */
  title: string
  /** True only when a genuinely new title should be saved. */
  changed: boolean
}

export function resolveTitleCommit(current: string, draft: string): TitleCommit {
  const cleaned = draft.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX_LENGTH)
  if (!cleaned || cleaned === current) return { title: current, changed: false }
  return { title: cleaned, changed: true }
}
