import { describe, it, expect } from 'vitest'
import {
  resolvePageSetup, usableWidthMm, usableHeightMm, cssPageSize, toMm, fromMm,
  validateCustomSizeMm, validateMarginsMm, pageSizeLabel, PAGE_SIZES, FOOTER_RESERVE_MM,
} from './pageSetup'

describe('resolvePageSetup', () => {
  it('legacy doc without fields resolves to A4 portrait + Normal', () => {
    const s = resolvePageSetup({})
    expect(s.sizeId).toBe('A4')
    expect(s.widthMm).toBe(210)
    expect(s.heightMm).toBe(297)
    expect(s.margins).toEqual({ top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 })
    expect(s.marginsPreset).toBe('normal')
  })
  it('named sizes carry their standard dimensions', () => {
    expect(resolvePageSetup({ pageSize: 'A3' })).toMatchObject({ widthMm: 297, heightMm: 420 })
    expect(resolvePageSetup({ pageSize: 'A5' })).toMatchObject({ widthMm: 148, heightMm: 210 })
    expect(resolvePageSetup({ pageSize: 'Letter' })).toMatchObject({ widthMm: 215.9, heightMm: 279.4 })
    expect(resolvePageSetup({ pageSize: 'Legal' })).toMatchObject({ widthMm: 215.9, heightMm: 355.6 })
    expect(resolvePageSetup({ pageSize: 'Tabloid' })).toMatchObject({ widthMm: 279.4, heightMm: 431.8 })
    expect(PAGE_SIZES.A4).toEqual({ w: 210, h: 297 })
  })
  it('landscape swaps the dimensions', () => {
    const s = resolvePageSetup({ pageSize: 'A4', orientation: 'landscape' })
    expect(s.widthMm).toBe(297)
    expect(s.heightMm).toBe(210)
  })
  it('custom size uses the stored millimetres', () => {
    const s = resolvePageSetup({ pageSize: 'Custom', pageW: 100, pageH: 150 })
    expect(s.widthMm).toBe(100)
    expect(s.heightMm).toBe(150)
  })
  it('custom size with unusable stored dims falls back to A4 dims, keeps the label', () => {
    const s = resolvePageSetup({ pageSize: 'Custom', pageW: 5, pageH: 99999 })
    expect(s.sizeId).toBe('Custom')
    expect(s.widthMm).toBe(210)
  })
  it('unknown size id falls back to A4', () => {
    expect(resolvePageSetup({ pageSize: 'B5' }).sizeId).toBe('A4')
  })
  it('margin presets match Word values, Moderate and Wide included', () => {
    expect(resolvePageSetup({ margins: 'narrow' }).margins.left).toBe(12.7)
    expect(resolvePageSetup({ margins: 'moderate' }).margins).toEqual({ top: 25.4, right: 19.05, bottom: 25.4, left: 19.05 })
    expect(resolvePageSetup({ margins: 'wide' }).margins).toEqual({ top: 25.4, right: 50.8, bottom: 25.4, left: 50.8 })
  })
  it('custom margins are used only when valid', () => {
    const good = { top: 10, right: 15, bottom: 10, left: 15 }
    expect(resolvePageSetup({ margins: 'custom', customMargins: good }).margins).toEqual(good)
    const bad = { top: -1, right: 15, bottom: 10, left: 15 }
    expect(resolvePageSetup({ margins: 'custom', customMargins: bad }).margins.left).toBe(25.4)
  })
})

describe('usable area + css size', () => {
  it('usable height subtracts margins and the footer reserve', () => {
    const s = resolvePageSetup({})
    expect(usableHeightMm(s)).toBeCloseTo(297 - 25.4 - 25.4 - FOOTER_RESERVE_MM, 5)
    expect(usableWidthMm(s)).toBeCloseTo(210 - 50.8, 5)
  })
  it('cssPageSize emits explicit millimetres', () => {
    expect(cssPageSize(resolvePageSetup({}))).toBe('210mm 297mm')
    expect(cssPageSize(resolvePageSetup({ pageSize: 'A4', orientation: 'landscape' }))).toBe('297mm 210mm')
  })
  it('label shows size and dimensions', () => {
    expect(pageSizeLabel(resolvePageSetup({}))).toBe('A4 · 210 × 297 mm')
  })
})

describe('unit conversion', () => {
  it('mm/cm/inch round-trip', () => {
    expect(toMm(2.54, 'cm')).toBeCloseTo(25.4, 5)
    expect(toMm(1, 'in')).toBe(25.4)
    expect(toMm(10, 'mm')).toBe(10)
    expect(fromMm(25.4, 'in')).toBe(1)
    expect(fromMm(210, 'cm')).toBe(21)
  })
})

describe('validation', () => {
  it('custom size range is 50..1000mm', () => {
    expect(validateCustomSizeMm(100, 150)).toBeNull()
    expect(validateCustomSizeMm(49, 150)).toBe('range')
    expect(validateCustomSizeMm(100, 1001)).toBe('range')
    expect(validateCustomSizeMm(NaN, 150)).toBe('range')
  })
  it('margins must be 0..100 and leave a usable area', () => {
    expect(validateMarginsMm({ top: 10, right: 10, bottom: 10, left: 10 }, 210, 297)).toBeNull()
    expect(validateMarginsMm({ top: 101, right: 10, bottom: 10, left: 10 }, 210, 297)).toBe('range')
    expect(validateMarginsMm({ top: 10, right: 90, bottom: 10, left: 90 }, 210, 297)).toBe('usable')
    expect(validateMarginsMm({ top: 90, right: 10, bottom: 90, left: 10 }, 210, 210)).toBe('usable')
  })
})
