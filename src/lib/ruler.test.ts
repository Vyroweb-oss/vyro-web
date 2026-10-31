import { describe, it, expect } from 'vitest'
import { MM_PX, cmTicks, labelsVisible, marginMmFor, marginZones, mmToPx } from './ruler'

describe('ruler', () => {
  it('marginMmFor resolves narrow/normal/wide and falls back to normal', () => {
    expect(marginMmFor('narrow')).toBe(12.7)
    expect(marginMmFor('normal')).toBe(25.4)
    expect(marginMmFor('wide')).toBe(38.1)
    expect(marginMmFor(undefined)).toBe(25.4)
    expect(marginMmFor('bogus')).toBe(25.4)
  })

  it('cmTicks: A4 portrait width 210mm gives 22 ticks, 0–21cm', () => {
    const ticks = cmTicks(210)
    expect(ticks).toHaveLength(22)
    expect(ticks[0]).toEqual({ cm: 0, mm: 0 })
    expect(ticks[21]).toEqual({ cm: 21, mm: 210 })
    expect(ticks.map((t) => t.mm)).toEqual(ticks.map((t) => t.cm * 10))
  })

  it('cmTicks: A4 landscape width 297mm gives 30 ticks, 0–29cm', () => {
    const ticks = cmTicks(297)
    expect(ticks).toHaveLength(30)
    expect(ticks[29]).toEqual({ cm: 29, mm: 290 })
    // No tick past the page end (297mm is not a whole cm).
    expect(ticks.every((t) => t.mm <= 297)).toBe(true)
  })

  it('cmTicks: portrait height 297mm and empty/negative lengths', () => {
    expect(cmTicks(297)).toHaveLength(30)
    expect(cmTicks(0)).toEqual([])
    expect(cmTicks(-5)).toEqual([])
  })

  it('marginZones: narrow/normal/wide on portrait and landscape', () => {
    const cases: [number, string, number][] = [
      [210, 'narrow', 12.7], [210, 'normal', 25.4], [210, 'wide', 38.1],
      [297, 'narrow', 12.7], [297, 'normal', 25.4], [297, 'wide', 38.1],
    ]
    for (const [page, preset, m] of cases) {
      const z = marginZones(page, marginMmFor(preset))
      expect(z.startMm).toBe(m)
      expect(z.textFromMm).toBe(m)
      expect(z.endFromMm).toBe(page - m)
      expect(z.textToMm).toBe(page - m)
      // Zones tile the page exactly: start + text + end = page.
      expect(z.startMm + (z.textToMm - z.textFromMm) + (page - z.endFromMm)).toBeCloseTo(page, 9)
    }
  })

  it('marginZones never exceed the page, even on a tiny page', () => {
    for (const page of [210, 297, 20, 5]) {
      for (const preset of ['narrow', 'normal', 'wide'] as const) {
        const z = marginZones(page, marginMmFor(preset))
        expect(z.startMm).toBeGreaterThanOrEqual(0)
        expect(z.startMm).toBeLessThanOrEqual(page)
        expect(z.endFromMm).toBeGreaterThanOrEqual(0)
        expect(z.endFromMm).toBeLessThanOrEqual(page)
        expect(z.textToMm - z.textFromMm).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('mmToPx at 50/100/200% scales', () => {
    expect(mmToPx(10, 1)).toBeCloseTo(10 * MM_PX, 9)
    expect(mmToPx(10, 0.5)).toBeCloseTo(5 * MM_PX, 9)
    expect(mmToPx(10, 2)).toBeCloseTo(20 * MM_PX, 9)
    expect(mmToPx(210, 1)).toBeCloseTo(210 * MM_PX, 9)
    // Doubling the scale doubles the pixels.
    expect(mmToPx(25.4, 2)).toBeCloseTo(2 * mmToPx(25.4, 1), 9)
  })

  it('labelsVisible hides labels when too cramped at small scale', () => {
    expect(labelsVisible(1)).toBe(true)
    expect(labelsVisible(0.5)).toBe(true)
    expect(labelsVisible(0.1)).toBe(false)
    expect(labelsVisible(0.25)).toBe(false)
  })
})
