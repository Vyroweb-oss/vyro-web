import { describe, it, expect } from 'vitest'
import { TITLE_BAR_OVERFLOW_BREAKPOINT, TITLE_BAR_PROTECTED, titleBarLayout, isTitleBarOverflowWidth } from './titleBar'

describe('titleBarLayout', () => {
  it('shows every item in the bar at a wide width', () => {
    const layout = titleBarLayout(1280)
    expect(layout.isOverflow).toBe(false)
    expect(layout.overflow).toEqual([])
    expect(layout.visible).toEqual(['back', 'logo', 'qat', 'title', 'saveStatus', 'badge', 'palette', 'language', 'theme', 'settings'])
  })
  it('moves only the low-use items into overflow at a narrow width', () => {
    const layout = titleBarLayout(360)
    expect(layout.isOverflow).toBe(true)
    expect(layout.overflow).toEqual(['palette', 'language', 'theme', 'settings'])
    expect(layout.visible).toEqual(['back', 'logo', 'qat', 'title', 'saveStatus', 'badge'])
  })
  it('keeps the protected set visible at every width', () => {
    for (const width of [320, 719, 720, 1920]) {
      const layout = titleBarLayout(width)
      for (const item of TITLE_BAR_PROTECTED) {
        expect(layout.visible).toContain(item)
        expect(layout.overflow).not.toContain(item)
      }
    }
  })
  it('uses the exact 720px breakpoint: 719 overflows, 720 does not', () => {
    expect(TITLE_BAR_OVERFLOW_BREAKPOINT).toBe(720)
    expect(isTitleBarOverflowWidth(719)).toBe(true)
    expect(isTitleBarOverflowWidth(720)).toBe(false)
    expect(titleBarLayout(719).overflow).toEqual(['palette', 'language', 'theme', 'settings'])
    expect(titleBarLayout(720).overflow).toEqual([])
  })
  it('treats impossible widths as narrow so nothing can overflow the bar', () => {
    expect(isTitleBarOverflowWidth(NaN)).toBe(true)
    expect(isTitleBarOverflowWidth(-100)).toBe(true)
    expect(titleBarLayout(NaN).overflow).toEqual(['palette', 'language', 'theme', 'settings'])
    for (const item of TITLE_BAR_PROTECTED) expect(titleBarLayout(NaN).visible).toContain(item)
  })
  it('never duplicates or drops an item across visible + overflow', () => {
    for (const width of [360, 720, 1280]) {
      const layout = titleBarLayout(width)
      const all = [...layout.visible, ...layout.overflow]
      expect(new Set(all).size).toBe(all.length)
      expect(all.sort()).toEqual(['back', 'badge', 'language', 'logo', 'palette', 'qat', 'saveStatus', 'settings', 'theme', 'title'].sort())
    }
  })
})
