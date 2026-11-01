import { describe, it, expect } from 'vitest'
import { SYMBOL_CATEGORIES, symbolCategoryIds, symbolsForCategory, searchSymbols } from './symbols'

describe('symbols catalogue', () => {
  it('has five non-empty categories of a modest size', () => {
    expect(symbolCategoryIds()).toEqual(['punctuation', 'math', 'currency', 'arrows', 'greek'])
    for (const c of SYMBOL_CATEGORIES) {
      expect(c.entries.length).toBeGreaterThanOrEqual(8)
      expect(c.entries.length).toBeLessThanOrEqual(16)
    }
  })
  it('every char is exactly one printable code point, never whitespace or emoji', () => {
    for (const c of SYMBOL_CATEGORIES) {
      for (const s of c.entries) {
        expect([...s.char].length, `${c.id}/${s.name}`).toBe(1)
        expect(s.char.trim(), `${c.id}/${s.name}`).toBe(s.char)
        expect(s.char.length).toBeGreaterThan(0)
        const cp = s.char.codePointAt(0)!
        expect(cp).toBeGreaterThanOrEqual(0x20)
        expect(cp).not.toBe(0x7f)
        // No emoji block, no joiner / variation selector: single-codepoint
        // glyphs only, so nothing here can render as a colour emoji.
        expect(cp < 0x1f000 || cp > 0x1faff, `${c.id}/${s.name} U+${cp.toString(16)}`).toBe(true)
        expect([0x200d, 0xfe0e, 0xfe0f]).not.toContain(cp)
        expect(s.name.trim().length).toBeGreaterThan(0)
      }
    }
  })
  it('no duplicate chars within a category, and none across the whole catalogue', () => {
    const all: string[] = []
    for (const c of SYMBOL_CATEGORIES) {
      const chars = c.entries.map((s) => s.char)
      expect(new Set(chars).size, `duplicates in ${c.id}`).toBe(chars.length)
      all.push(...chars)
    }
    expect(new Set(all).size).toBe(all.length)
  })
  it('search matches by name, case-insensitively', () => {
    expect(searchSymbols('alpha').map((s) => s.char)).toContain('α')
    expect(searchSymbols('ALPHA').map((s) => s.char)).toContain('α')
    expect(searchSymbols('arrow').length).toBeGreaterThan(5)
    // A name substring narrows to the matching entries only.
    expect(searchSymbols('double arrow').map((s) => s.char).sort()).toEqual(['⇐', '⇒'])
  })
  it('search matches by the character itself', () => {
    expect(searchSymbols('€').map((s) => s.name)).toEqual(['euro sign'])
    expect(searchSymbols('→').map((s) => s.name)).toEqual(['rightwards arrow'])
  })
  it('blank query matches nothing and an unknown category returns empty', () => {
    expect(searchSymbols('')).toEqual([])
    expect(searchSymbols('   ')).toEqual([])
    expect(searchSymbols('zzz-no-such-symbol')).toEqual([])
    expect(symbolsForCategory('dingbats')).toEqual([])
    expect(symbolsForCategory('')).toEqual([])
  })
  it('category lookup returns that category and only that category', () => {
    expect(symbolsForCategory('greek').map((s) => s.char)).toContain('Ω')
    expect(symbolsForCategory('greek').some((s) => s.char === '€')).toBe(false)
  })
})
