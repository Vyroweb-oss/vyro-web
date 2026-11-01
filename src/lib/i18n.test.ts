import { describe, it, expect } from 'vitest'
import { STRINGS, tr, resolveUiLang, loadUiLang, saveUiLang, uiDir, UI_LANG_KEY } from './i18n'
import { countNoun } from './wordChrome'

describe('i18n', () => {
  it('en and fa have identical key sets', () => {
    const en = Object.keys(STRINGS.en).sort()
    const fa = Object.keys(STRINGS.fa).sort()
    expect(fa).toEqual(en)
  })
  it('every translation is a non-empty string', () => {
    for (const lang of ['en', 'fa'] as const) for (const [k, v] of Object.entries(STRINGS[lang])) expect(typeof v === 'string' && v.length > 0, `${lang}.${k}`).toBe(true)
  })
  it('fa strings actually differ from en for chrome keys (not placeholders)', () => {
    expect(tr('fa', 'newDocument')).not.toBe(tr('en', 'newDocument'))
    expect(tr('fa', 'tabHome')).not.toBe(tr('en', 'tabHome'))
    expect(tr('fa', 'recentDocuments')).not.toBe(tr('en', 'recentDocuments'))
  })
  it('lang resolution + persistence roundtrip', () => {
    expect(resolveUiLang('fa')).toBe('fa'); expect(resolveUiLang('xx')).toBe('en'); expect(resolveUiLang(null)).toBe('en')
    const m = new Map<string, string>(); const fake = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } }
    saveUiLang(fake as any, 'fa'); expect(m.get(UI_LANG_KEY)).toBe('fa'); expect(loadUiLang(fake as any)).toBe('fa')
    expect(loadUiLang({ getItem: () => { throw new Error('blocked') } } as any)).toBe('en')
  })
  it('ui direction follows language', () => { expect(uiDir('fa')).toBe('rtl'); expect(uiDir('en')).toBe('ltr') })
  it('P2-10: paragraph count noun is lowercase and distinct from the panel label', () => {
    // Review ribbon count phrase: "1 paragraph" / "2 paragraphs", matching
    // the lowercase "1 word" / "2 words" pattern — not the capitalized
    // Statistics-panel label "Paragraphs".
    expect(tr('en', 'paragraphs')).toBe('paragraphs')
    expect(countNoun(1, tr('en', 'paragraphSingular'), tr('en', 'paragraphs'))).toBe('paragraph')
    expect(countNoun(2, tr('en', 'paragraphSingular'), tr('en', 'paragraphs'))).toBe('paragraphs')
    expect(tr('fa', 'paragraphs')).toBe('پاراگراف‌ها')
    // The panel label key is untouched: StatsPanel still renders "Paragraphs".
    expect(tr('en', 'statsParagraphs')).toBe('Paragraphs')
  })
})
