// Page setup model (Pagination mission, owner 2026-10-31): paper sizes,
// orientation, margin presets and custom values — all stored in millimetres
// on the document, all optional so legacy documents resolve to A4/Normal.
//
// Word's real preset values are used: Normal = 1in everywhere, Narrow =
// 0.5in everywhere, Moderate = 1in top/bottom + 0.75in sides, Wide = 1in
// top/bottom + 2in sides. (The pre-mission 'wide' was a uniform 38.1mm
// approximation; it now resolves to Word's Wide.)

export type PageSizeId = 'A3' | 'A4' | 'A5' | 'Letter' | 'Legal' | 'Tabloid' | 'Custom'
export type LengthUnit = 'mm' | 'cm' | 'in'

export interface MarginsMm { top: number; right: number; bottom: number; left: number }

export interface PageSetup {
  sizeId: PageSizeId
  /** Portrait dimensions with orientation already applied. */
  widthMm: number
  heightMm: number
  margins: MarginsMm
  marginsPreset: string
}

export const PAGE_SIZES: Record<Exclude<PageSizeId, 'Custom'>, { w: number; h: number }> = {
  A3: { w: 297, h: 420 },
  A4: { w: 210, h: 297 },
  A5: { w: 148, h: 210 },
  Letter: { w: 215.9, h: 279.4 },
  Legal: { w: 215.9, h: 355.6 },
  Tabloid: { w: 279.4, h: 431.8 },
}

export const PAGE_SIZE_IDS: PageSizeId[] = ['A3', 'A4', 'A5', 'Letter', 'Legal', 'Tabloid', 'Custom']

export const MARGIN_PRESETS: Record<string, MarginsMm> = {
  normal: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
  narrow: { top: 12.7, right: 12.7, bottom: 12.7, left: 12.7 },
  moderate: { top: 25.4, right: 19.05, bottom: 25.4, left: 19.05 },
  wide: { top: 25.4, right: 50.8, bottom: 25.4, left: 50.8 },
}

/** Space reserved at the bottom of every sheet for the page-number strip,
 * mirroring the print @page bottom margin so the on-screen pagination and
 * the printed pagination use the SAME usable height. */
export const FOOTER_RESERVE_MM = 12

export const CUSTOM_SIZE_MIN_MM = 50
export const CUSTOM_SIZE_MAX_MM = 1000
export const MARGIN_MAX_MM = 100
export const MIN_USABLE_MM = 50

interface DocPageFields {
  pageSize?: string
  pageW?: number
  pageH?: number
  orientation?: string
  margins?: string
  customMargins?: MarginsMm
}

function validDim(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= CUSTOM_SIZE_MIN_MM && v <= CUSTOM_SIZE_MAX_MM
}

function validMargins(m: unknown): m is MarginsMm {
  if (!m || typeof m !== 'object') return false
  const r = m as Record<string, unknown>
  return (['top', 'right', 'bottom', 'left'] as const).every(
    k => typeof r[k] === 'number' && Number.isFinite(r[k] as number) && (r[k] as number) >= 0 && (r[k] as number) <= MARGIN_MAX_MM,
  )
}

/** Resolve a document's effective page setup. Unknown/missing values fall
 * back to A4 portrait + Normal margins — legacy documents open unchanged. */
export function resolvePageSetup(doc: DocPageFields): PageSetup {
  const sizeId: PageSizeId = (PAGE_SIZE_IDS as string[]).includes(doc.pageSize || '')
    ? (doc.pageSize as PageSizeId)
    : 'A4'
  let w: number
  let h: number
  if (sizeId === 'Custom' && validDim(doc.pageW) && validDim(doc.pageH)) {
    w = doc.pageW
    h = doc.pageH
  } else if (sizeId === 'Custom') {
    // Custom chosen but stored dims are unusable — fall back to A4 dims
    // while keeping the Custom label so the user can fix them in the dialog.
    w = PAGE_SIZES.A4.w
    h = PAGE_SIZES.A4.h
  } else {
    const s = PAGE_SIZES[sizeId as Exclude<PageSizeId, 'Custom'>]
    w = s.w
    h = s.h
  }
  if (doc.orientation === 'landscape' && h > w) {
    const t = w
    w = h
    h = t
  }
  if (doc.orientation !== 'landscape' && w > h && sizeId !== 'Custom') {
    // Named sizes are stored portrait; a landscape swap only happens via
    // the orientation flag, handled above.
  }
  const preset = typeof doc.margins === 'string' ? doc.margins : 'normal'
  let margins: MarginsMm
  if (preset === 'custom' && validMargins(doc.customMargins)) {
    margins = { ...doc.customMargins }
  } else if (MARGIN_PRESETS[preset]) {
    margins = { ...MARGIN_PRESETS[preset] }
  } else {
    margins = { ...MARGIN_PRESETS.normal }
  }
  return { sizeId, widthMm: w, heightMm: h, margins, marginsPreset: preset === 'custom' && validMargins(doc.customMargins) ? 'custom' : MARGIN_PRESETS[preset] ? preset : 'normal' }
}

export function usableWidthMm(setup: PageSetup): number {
  return setup.widthMm - setup.margins.left - setup.margins.right
}

export function usableHeightMm(setup: PageSetup): number {
  return setup.heightMm - setup.margins.top - setup.margins.bottom - FOOTER_RESERVE_MM
}

/** CSS @page size value — explicit millimetres for every size so named
 * renderer keywords (Tabloid support is inconsistent) are never relied on. */
export function cssPageSize(setup: PageSetup): string {
  return `${round1(setup.widthMm)}mm ${round1(setup.heightMm)}mm`
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** Convert a user-entered value in the chosen unit to millimetres. */
export function toMm(value: number, unit: LengthUnit): number {
  if (unit === 'cm') return value * 10
  if (unit === 'in') return value * 25.4
  return value
}

/** Convert millimetres back to the chosen unit for display in inputs. */
export function fromMm(mm: number, unit: LengthUnit): number {
  if (unit === 'cm') return round1(mm / 10)
  if (unit === 'in') return Math.round((mm / 25.4) * 100) / 100
  return round1(mm)
}

/** Validate a custom page size (values already in mm).
 * Returns an error code ('range') or null when valid. */
export function validateCustomSizeMm(wMm: number, hMm: number): 'range' | null {
  if (!Number.isFinite(wMm) || !Number.isFinite(hMm)) return 'range'
  if (wMm < CUSTOM_SIZE_MIN_MM || wMm > CUSTOM_SIZE_MAX_MM) return 'range'
  if (hMm < CUSTOM_SIZE_MIN_MM || hMm > CUSTOM_SIZE_MAX_MM) return 'range'
  return null
}

/** Validate custom margins (mm) against a page: each margin 0..100mm and
 * the usable area must stay at least MIN_USABLE_MM in both directions. */
export function validateMarginsMm(m: MarginsMm, pageWMm: number, pageHMm: number): 'range' | 'usable' | null {
  for (const k of ['top', 'right', 'bottom', 'left'] as const) {
    if (!Number.isFinite(m[k]) || m[k] < 0 || m[k] > MARGIN_MAX_MM) return 'range'
  }
  if (pageWMm - m.left - m.right < MIN_USABLE_MM) return 'usable'
  if (pageHMm - m.top - m.bottom - FOOTER_RESERVE_MM < MIN_USABLE_MM) return 'usable'
  return null
}

/** Human label like "A4 · 210 × 297 mm" for the Layout tab. */
export function pageSizeLabel(setup: PageSetup): string {
  return `${setup.sizeId} · ${round1(setup.widthMm)} × ${round1(setup.heightMm)} mm`
}

/** CSS padding string (top right bottom left) for the page element. */
export function marginsPaddingCss(m: MarginsMm): string {
  return `${round1(m.top)}mm ${round1(m.right)}mm ${round1(m.bottom)}mm ${round1(m.left)}mm`
}
