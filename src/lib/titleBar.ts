// PC1 title-bar layout helpers (PIXEL-CLOSE, Word title bar exact).
// Pure functions over a viewport width — no storage, no network, no DOM.
// The layout rule they encode must match src/index.css: below the
// breakpoint the low-use items collapse into the "⋯" overflow menu, while
// the protected set (back button, QAT, editable title, save status) is
// always visible and can never be pushed out or overlapped.

export const TITLE_BAR_OVERFLOW_BREAKPOINT = 720

export type TitleBarItemId =
  | 'back'
  | 'logo'
  | 'file'
  | 'qat'
  | 'title'
  | 'saveStatus'
  | 'palette'
  | 'language'
  | 'theme'
  | 'settings'

/** Items that must stay in the bar at every width (task §3 protected set). */
export const TITLE_BAR_PROTECTED: readonly TitleBarItemId[] = ['back', 'qat', 'title', 'saveStatus']

/** Low-use items that move into the "⋯" menu below the breakpoint. */
export const TITLE_BAR_OVERFLOWABLE: readonly TitleBarItemId[] = ['palette', 'language', 'theme', 'settings']

export interface TitleBarLayout {
  /** True when the viewport is narrow enough to show the overflow menu. */
  isOverflow: boolean
  /** Items rendered directly in the bar. */
  visible: TitleBarItemId[]
  /** Items rendered inside the "⋯" overflow menu (empty at wide widths). */
  overflow: TitleBarItemId[]
}

/** True when the overflow menu is shown at this width. */
export function isTitleBarOverflowWidth(width: number): boolean {
  // Non-finite or negative widths are impossible viewports; treat them as
  // the narrowest case so low-use items collapse rather than overflowing.
  if (!Number.isFinite(width) || width < 0) return true
  return width < TITLE_BAR_OVERFLOW_BREAKPOINT
}

/**
 * Split the title-bar items into visible vs overflowed at a given width.
 * The protected set is always in `visible`, at every width — the function
 * never overflows back, QAT, title or save status, and the logo (branding)
 * also stays in the bar. The Free/Premium badge left the title bar in the
 * 2026-10-31 desktop-tidy round (owner order, Word-like bar); plan status
 * lives on the dashboard header and in the premium dialog instead.
 */
export function titleBarLayout(width: number): TitleBarLayout {
  const overflow = isTitleBarOverflowWidth(width)
  const visible: TitleBarItemId[] = ['back', 'logo', 'file', 'qat', 'title', 'saveStatus']
  const overflowed: TitleBarItemId[] = []
  for (const item of TITLE_BAR_OVERFLOWABLE) {
    if (overflow) overflowed.push(item)
    else visible.push(item)
  }
  return { isOverflow: overflow, visible, overflow: overflowed }
}
