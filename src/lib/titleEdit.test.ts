import { describe, it, expect } from 'vitest'
import { resolveTitleCommit, TITLE_MAX_LENGTH } from './titleEdit'

describe('resolveTitleCommit (title-bar rename, spec §5)', () => {
  it('commits a genuinely new title', () => {
    expect(resolveTitleCommit('Untitled document', 'Quarterly report')).toEqual({ title: 'Quarterly report', changed: true })
  })
  it('trims and collapses whitespace in the committed title', () => {
    expect(resolveTitleCommit('Old', '  My   new\ttitle  ')).toEqual({ title: 'My new title', changed: true })
  })
  it('reverts on an empty draft — the title is never blanked', () => {
    expect(resolveTitleCommit('Keep me', '')).toEqual({ title: 'Keep me', changed: false })
  })
  it('reverts on a whitespace-only draft', () => {
    expect(resolveTitleCommit('Keep me', '   \n ')).toEqual({ title: 'Keep me', changed: false })
  })
  it('reports no change when the draft equals the current title', () => {
    expect(resolveTitleCommit('Same', 'Same')).toEqual({ title: 'Same', changed: false })
    expect(resolveTitleCommit('Same', '  Same  ')).toEqual({ title: 'Same', changed: false })
  })
  it('caps an over-long title at TITLE_MAX_LENGTH', () => {
    const long = 'x'.repeat(TITLE_MAX_LENGTH + 50)
    const r = resolveTitleCommit('Old', long)
    expect(r.changed).toBe(true)
    expect(r.title.length).toBe(TITLE_MAX_LENGTH)
  })
})
