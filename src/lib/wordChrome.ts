// Word-style chrome helpers (SPRINT-WORD, chrome/layout only).
// Pure functions over values the editor already owns — no storage, no
// network, no document mutation. Zoom limits mirror the editor's existing
// 50%–200% range; the page estimate mirrors stats.ts (250 words/page,
// min 1 page for a non-empty document) so the status bar can never
// disagree with the Document Statistics panel.

export const ZOOM_MIN = 50
export const ZOOM_MAX = 200

/** Clamp a zoom percentage to the editor's 50%–200% range. Non-finite input resets to 100%. */
export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 100
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value)))
}

/** One zoom step from the current value (buttons move in 10% steps). */
export function zoomStep(current: number, delta: number): number {
  return clampZoom(current + delta)
}

/** Status-bar language/direction label for a document direction.
 * Kept for backward compatibility; the footer now shows language and
 * direction as two distinct items via documentLanguageLabel /
 * documentDirectionLabel below, which recombine to this exact string. */
export function docLanguageLabel(dir: string): string {
  return dir === 'rtl' ? 'RTL · دری/فارسی' : 'LTR · English'
}

/** Status-bar language item for a document direction (PC4 split). */
export function documentLanguageLabel(dir: string): string {
  return dir === 'rtl' ? 'دری/فارسی' : 'English'
}

/** Status-bar direction item for a document direction (PC4 split). */
export function documentDirectionLabel(dir: string): string {
  return dir === 'rtl' ? 'RTL' : 'LTR'
}

/** Estimated pages from a word count, exactly as stats.ts defines it. */
export function estimatedPagesFromWords(words: number): number {
  if (!Number.isFinite(words) || words <= 0) return 0
  return Math.max(1, Math.ceil(words / 250))
}

/** Singular/plural noun for a count: singular only at exactly 1.
 * Non-finite and negative counts take the plural (they are never "1 item"). */
export function countNoun(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural
}

export type ParagraphStyleId = 'normal' | 'heading1' | 'heading2' | 'heading3' | 'title'

export interface ParagraphStyleState {
  isHeading1: boolean
  isHeading2: boolean
  isHeading3: boolean
  isParagraph: boolean
  isBold: boolean
  fontSizePx: number | null
}

/**
 * Which Styles-gallery button is active at the cursor. Title has no named
 * paragraph style in this editor (only heading node types exist), so it is
 * honestly defined as what its button applies: a paragraph set in 28px
 * bold — the same existing setParagraph / setFontSize / toggleBold
 * commands, not a fake named style. Anything else in a paragraph is Normal.
 */
export function activeParagraphStyle(s: ParagraphStyleState): ParagraphStyleId | null {
  if (s.isHeading1) return 'heading1'
  if (s.isHeading2) return 'heading2'
  if (s.isHeading3) return 'heading3'
  if (!s.isParagraph) return null
  if (s.isBold && s.fontSizePx === 28) return 'title'
  return 'normal'
}
