// PC3 — page rulers: pure geometry only, no DOM, no React.
// The rulers are DISPLAY-ONLY (Word-style drag-to-change-margins is out
// of scope): this module converts the real page geometry — page size in
// mm (orientation-aware), the document's actual margin preset, and the
// editor's effective scale — into tick positions and margin zones that
// src/components/Rulers.tsx renders. Margins are uniform on all sides
// (narrow 12.7mm / normal 25.4mm / wide 38.1mm, matching Editor's
// MARGINS), so the horizontal and vertical zones use the same margin.

export const MM_PX = 96 / 25.4

export type MarginPreset = 'narrow' | 'normal' | 'wide'

const MARGIN_MM: Record<MarginPreset, number> = {
  narrow: 12.7,
  normal: 25.4,
  wide: 38.1,
}

/** Margin in mm for a preset; unknown values fall back to normal. */
export function marginMmFor(preset: string | undefined | null): number {
  if (preset === 'narrow' || preset === 'normal' || preset === 'wide') return MARGIN_MM[preset]
  return MARGIN_MM.normal
}

/** Millimetres to CSS pixels at a given scale (1 = 100%). */
export function mmToPx(mm: number, scale: number): number {
  return mm * MM_PX * scale
}

export interface CmTick {
  /** Whole centimetres from the page edge (0, 1, 2, …). */
  cm: number
  /** Position from the page edge in mm (cm × 10). */
  mm: number
}

/**
 * One tick per whole centimetre along a length, starting at 0 and never
 * past the end: A4 portrait width (210mm) gives 22 ticks (0–21cm),
 * landscape width (297mm) gives 30 ticks (0–29cm).
 */
export function cmTicks(lengthMm: number): CmTick[] {
  if (!(lengthMm > 0)) return []
  const ticks: CmTick[] = []
  for (let cm = 0; cm * 10 <= lengthMm; cm++) ticks.push({ cm, mm: cm * 10 })
  return ticks
}

export interface MarginZones {
  /** Leading margin zone, [0, startMm]. */
  startMm: number
  /** Text area, [startMm, endFromMm]. Never negative-length. */
  textFromMm: number
  textToMm: number
  /** Trailing margin zone, [endFromMm, pageMm]. */
  endFromMm: number
  pageMm: number
}

/**
 * Margin zones for a page of `pageMm` with a uniform `marginMm` margin.
 * The margin is clamped to half the page so the zones can never exceed
 * the page or overlap: on a pathologically small page the two margin
 * zones simply meet in the middle and the text area is zero-length.
 */
export function marginZones(pageMm: number, marginMm: number): MarginZones {
  const page = Math.max(0, pageMm)
  const m = Math.min(Math.max(0, marginMm), page / 2)
  return { startMm: m, textFromMm: m, textToMm: page - m, endFromMm: page - m, pageMm: page }
}

/**
 * Whether cm labels are readable at a scale: a 2cm label span needs at
 * least 26px, otherwise only the ticks render (labels hidden when too
 * cramped at small scale).
 */
export function labelsVisible(scale: number): boolean {
  return mmToPx(20, scale) >= 26
}
