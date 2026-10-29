import { describe,it,expect } from 'vitest'
import { formatDocDate } from './date'
describe('formatDocDate',()=>{
  const d = new Date(2026, 9, 29) // 29 Oct 2026, local time
  it('LTR gives an English long date',()=>{ expect(formatDocDate('ltr', d)).toBe('29 October 2026') })
  it('RTL gives a Persian (fa-AF) long date',()=>{
    const s = formatDocDate('rtl', d)
    expect(s).toMatch(/[؀-ۿ]/) // Arabic-script block (Persian letters)
    expect(s).toMatch(/[۰-۹]/)       // Persian digits
    expect(s).not.toContain('2026')              // Persian calendar year, not Gregorian
    expect(s).not.toBe(formatDocDate('ltr', d))
  })
  it('defaults to today and is non-empty both ways',()=>{ expect(formatDocDate('ltr').length).toBeGreaterThan(0); expect(formatDocDate('rtl').length).toBeGreaterThan(0) })
})
