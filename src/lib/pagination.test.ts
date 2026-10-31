import { describe, it, expect } from 'vitest'
import { computePagination, type PageSegment } from './pagination'

const U = 1000 // usable height px
const seg = (height: number, breakBefore = false): PageSegment => ({ height, breakBefore })

describe('computePagination', () => {
  it('empty document is one page', () => {
    expect(computePagination([], U).pageCount).toBe(1)
  })
  it('content that fits stays on one page', () => {
    const r = computePagination([seg(300), seg(300), seg(300)], U)
    expect(r.pageCount).toBe(1)
    expect(r.starts).toEqual([])
  })
  it('overflow moves the block to the next page', () => {
    const r = computePagination([seg(600), seg(600)], U)
    expect(r.pageCount).toBe(2)
    expect(r.starts).toEqual([{ index: 1, page: 1, usedBefore: 600 }])
    expect(r.pageOf).toEqual([0, 1])
  })
  it('an exactly-full page does not spill', () => {
    const r = computePagination([seg(500), seg(500), seg(10)], U)
    expect(r.pageCount).toBe(2)
    expect(r.starts[0].index).toBe(2)
  })
  it('manual break always starts a new page', () => {
    const r = computePagination([seg(100), seg(50, true), seg(50)], U)
    expect(r.pageCount).toBe(2)
    expect(r.pageOf).toEqual([0, 1, 1])
  })
  it('a document starting with content after a break counts the marker page', () => {
    // segments: [pageBreak node (h 2), its breakBefore flag lands on seg 1]
    const r = computePagination([seg(2), seg(100, true)], U)
    expect(r.pageCount).toBe(2)
  })
  it('trailing break (zero-height flagged segment) yields a final empty page', () => {
    const r = computePagination([seg(200), seg(2), seg(0, true)], U)
    expect(r.pageCount).toBe(2)
    expect(r.pageOf).toEqual([0, 0, 1])
  })
  it('consecutive breaks create consecutive pages', () => {
    const r = computePagination([seg(2), seg(2, true), seg(100, true)], U)
    expect(r.pageCount).toBe(3)
  })
  it('many pages: 10 segments of 400px over 1000px usable', () => {
    const r = computePagination(Array.from({ length: 10 }, () => seg(400)), U)
    // 2 per page (800) -> 5 pages
    expect(r.pageCount).toBe(5)
    expect(r.pageOf.filter(p => p === 4).length).toBe(2)
  })
  it('oversize unsplittable block occupies its page instead of vanishing', () => {
    const r = computePagination([seg(300), seg(2500), seg(100)], U)
    // block 2 cannot fit after 300 -> new page; it overflows that page;
    // block 3 starts fresh on the next page.
    expect(r.pageOf[1]).toBe(1)
    expect(r.pageOf[2]).toBe(2)
    expect(r.pageCount).toBe(3)
  })
  it('zero-height segments never force a break on their own', () => {
    const r = computePagination([seg(0), seg(0), seg(500)], U)
    expect(r.pageCount).toBe(1)
  })
})
