// Mobile ribbon display policy (owner order, 2026-10-31, after the
// root-cause investigation): on narrow screens the small tabs (Layout,
// References, Mailings, Review, View) WRAP so no implemented tool hides in
// the sideways scroll strip; group labels return in wrapped mode; the tab
// strip wraps into two rows so every tab is findable; the wide tabs keep
// the strip but with a VISIBLE thin scrollbar as the scroll cue. Desktop
// rules must stay untouched. These source guards pin that policy — a
// future CSS edit that re-hides tools on mobile fails here first.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
const editorSrc = readFileSync(resolve(process.cwd(), 'src/components/Editor.tsx'), 'utf8')
const WRAPPED_TABS = ['Layout', 'References', 'Mailings', 'Review', 'View']

describe('mobile ribbon: wrapped tabs cannot hide tools', () => {
  it('the ribbon carries the active tab as data-tab', () => {
    expect(editorSrc).toContain('<div className="ribbon" data-tab={tab}>')
  })
  it.each(WRAPPED_TABS)('%s wraps on mobile (no sideways strip)', (tab) => {
    // The five tabs share one combined selector rule; match the tab's
    // selector anywhere in that selector list before the declarations.
    const re = new RegExp(`\\.ribbon\\[data-tab='${tab}'\\][^{]*\\{flex-wrap:wrap;overflow-x:visible`)
    expect(css).toMatch(re)
  })
  it.each(WRAPPED_TABS)('%s shows its group labels in wrapped mode', (tab) => {
    expect(css).toContain(`.ribbon[data-tab='${tab}'] .rgroup-label`)
  })
  it('the tab strip wraps so every tab is findable without scrolling', () => {
    expect(css).toContain('scroll-snap-type:none;flex-wrap:wrap;overflow-x:visible')
  })
  it('the scroll-mode ribbon has a visible thin scrollbar cue (not display:none)', () => {
    expect(css).toContain('.ribbon::-webkit-scrollbar{display:block;height:6px}')
    expect(css).toContain('.ribbon{scrollbar-width:thin}')
  })
  it('Mailings shows its existing local-only note on mobile only', () => {
    expect(editorSrc).toContain('mailings-note')
    expect(editorSrc).toContain("t('mailMergeLocal')")
    expect(css).toContain('.mailings-note{display:none}')
    expect(css).toContain('.mailings-note{display:inline;max-width:230px}')
  })
})

describe('desktop ribbon rules are untouched', () => {
  it('base ribbon still wraps and the wide-screen nowrap rule remains', () => {
    expect(css).toContain('.ribbon{display:flex;flex-wrap:wrap')
    expect(css).toContain('@media (min-width:1100px)')
  })
  it('the mobile media block still hides labels only in the collapsed strip default', () => {
    // The blanket mobile label-hide remains for scroll-mode tabs; wrapped
    // tabs override it via the data-tab rules asserted above.
    expect(css).toContain('.rgroup-label{display:none}')
  })
})
