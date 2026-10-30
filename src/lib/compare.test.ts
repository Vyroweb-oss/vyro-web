import { describe, it, expect } from 'vitest'
import {
  flattenDocToLines, compareDocs, renderComparisonReport, saveChosenSideAsVersion,
} from './compare'
import type { VersionSnapshot } from './versions'

const para = (text: string) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })
const heading = (level: number, text: string) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] })
const doc = (...blocks: any[]) => ({ type: 'doc', content: blocks })

describe('compare: flatten', () => {
  it('flattens paragraphs, headings with level, list items, table cells and images', () => {
    const lines = flattenDocToLines(doc(
      para('Hello'),
      heading(2, 'Title'),
      { type: 'bulletList', content: [{ type: 'listItem', content: [para('Item one')] }] },
      { type: 'table', content: [{ type: 'tableRow', content: [
        { type: 'tableCell', content: [para('Cell A')] },
        { type: 'tableCell', content: [para('Cell B')] },
      ] }] },
      { type: 'image', attrs: { src: 'x.png', alt: 'Diagram' } },
    ))
    expect(lines.map((l) => l.text)).toEqual(['Hello', 'Title', 'Item one', 'Cell A', 'Cell B', '[image: Diagram]'])
    expect(lines[1]).toMatchObject({ kind: 'heading', level: 2 })
    expect(lines[2].kind).toBe('listItem')
    expect(lines[3].kind).toBe('tableCell')
    expect(lines[5].kind).toBe('image')
  })
  it('malformed input yields empty lines, never throws', () => {
    expect(flattenDocToLines(null)).toEqual([])
    expect(flattenDocToLines(undefined)).toEqual([])
    expect(flattenDocToLines('not json')).toEqual([])
    expect(flattenDocToLines({ type: 'doc' })).toEqual([])
    expect(flattenDocToLines({ type: 'paragraph', content: [] })).toEqual([])
    expect(flattenDocToLines(JSON.parse('{"type":"doc","content":null}'))).toEqual([])
  })
  it('empty doc flattens to []', () => {
    expect(flattenDocToLines(doc())).toEqual([])
    expect(flattenDocToLines(doc(para('')))).toEqual([])
  })
})

describe('compare: diff', () => {
  it('identical docs → zero changes, one unchanged hunk', () => {
    const r = compareDocs(doc(para('Same'), heading(1, 'Head')), doc(para('Same'), heading(1, 'Head')))
    expect(r.summary).toEqual({ added: 0, removed: 0, changed: 0, diffHunks: 0 })
    expect(r.hunks.every((h) => h.type === 'unchanged')).toBe(true)
  })
  it('added lines', () => {
    const r = compareDocs(doc(para('A')), doc(para('A'), para('B'), para('C')))
    expect(r.summary.added).toBe(2)
    expect(r.summary.removed).toBe(0)
    expect(r.summary.changed).toBe(0)
    expect(r.summary.diffHunks).toBe(1)
    expect(r.hunks.find((h) => h.type === 'added')?.bLines.map((l) => l.text)).toEqual(['B', 'C'])
  })
  it('removed lines', () => {
    const r = compareDocs(doc(para('A'), para('B')), doc(para('A')))
    expect(r.summary.removed).toBe(1)
    expect(r.summary.diffHunks).toBe(1)
    expect(r.hunks.find((h) => h.type === 'removed')?.aLines.map((l) => l.text)).toEqual(['B'])
  })
  it('adjacent removed+added lines pair as changed', () => {
    const r = compareDocs(doc(para('Old line')), doc(para('New line')))
    expect(r.summary.changed).toBe(1)
    expect(r.summary.added).toBe(0)
    expect(r.summary.removed).toBe(0)
    const changed = r.hunks.find((h) => h.type === 'changed')
    expect(changed?.aLines.map((l) => l.text)).toEqual(['Old line'])
    expect(changed?.bLines.map((l) => l.text)).toEqual(['New line'])
  })
  it('heading-level change counts as changed', () => {
    const r = compareDocs(doc(heading(1, 'Title')), doc(heading(2, 'Title')))
    expect(r.summary.changed).toBe(1)
    expect(r.summary.diffHunks).toBe(1)
  })
  it('empty doc vs non-empty → all added', () => {
    const r = compareDocs(doc(), doc(para('First'), para('Second')))
    expect(r.summary.added).toBe(2)
    expect(r.summary.diffHunks).toBe(1)
    const back = compareDocs(doc(para('First')), doc())
    expect(back.summary.removed).toBe(1)
  })
  it('FA/Dari text incl. ZWNJ-joined words diffs by whole line', () => {
    const zwnj = 'می‌خواهم' // contains ZWNJ
    const r = compareDocs(doc(para('سلام دنیا')), doc(para(`سلام ${zwnj}`)))
    expect(r.summary.changed).toBe(1)
    expect(r.hunks.find((h) => h.type === 'changed')?.bLines[0].text).toContain(zwnj)
    const same = compareDocs(doc(para(zwnj)), doc(para(zwnj)))
    expect(same.summary.diffHunks).toBe(0)
  })
  it('mixed FA+EN lines compare exactly', () => {
    const r = compareDocs(doc(para('Hello سلام')), doc(para('Hello سلام دنیا')))
    expect(r.summary.changed).toBe(1)
    const same = compareDocs(doc(para('Hello سلام')), doc(para('Hello سلام')))
    expect(same.summary.diffHunks).toBe(0)
  })
  it('summary counts combine across hunks', () => {
    const r = compareDocs(
      doc(para('Keep'), para('Drop me'), para('Edit me'), para('Tail')),
      doc(para('Keep'), para('Edit me!'), para('Tail'), para('Extra')),
    )
    expect(r.summary.removed).toBe(1)
    expect(r.summary.changed).toBe(1)
    expect(r.summary.added).toBe(1)
    expect(r.summary.diffHunks).toBe(3)
  })
  it('malformed docs never throw and compare as empty', () => {
    const r = compareDocs(null, doc(para('Hi')))
    expect(r.summary.added).toBe(1)
    expect(compareDocs({ nope: true }, { also: 'nope' }).summary.diffHunks).toBe(0)
  })
})

describe('compare: report + snapshot', () => {
  it('report contains the summary and both sides of changed lines', () => {
    const r = compareDocs(doc(para('Old line')), doc(para('New line')))
    const report = renderComparisonReport('Current', 'Version 1', r)
    expect(report).toContain('Added: 0')
    expect(report).toContain('Removed: 0')
    expect(report).toContain('Changed: 1')
    expect(report).toContain('Old line')
    expect(report).toContain('New line')
    expect(report).toContain('Current')
    expect(report).toContain('Version 1')
  })
  it('report for identical docs says no differences', () => {
    const r = compareDocs(doc(para('Same')), doc(para('Same')))
    expect(renderComparisonReport('A', 'B', r)).toContain('No differences')
  })
  it('snapshot-from-chosen-side produces a valid snapshot with the chosen content', () => {
    const chosen = doc(para('Chosen side'))
    const res = saveChosenSideAsVersion([] as VersionSnapshot[], { id: 'd1', title: 'Doc' }, chosen, 'from compare')
    expect(res).not.toBeNull()
    expect(res!.snapshot.docId).toBe('d1')
    expect(res!.snapshot.content).toEqual(chosen)
    expect(res!.snapshot.label).toBe('from compare')
    expect(res!.versions).toHaveLength(1)
    // The chosen content object is deep-copied: mutating the snapshot must
    // not leak back into the caller's content.
    res!.snapshot.content.content[0].content[0].text = 'MUTATED'
    expect(chosen.content[0].content[0].text).toBe('Chosen side')
  })
  it('snapshot helper rejects malformed chosen content', () => {
    expect(saveChosenSideAsVersion([] as VersionSnapshot[], { id: 'd1', title: 'Doc' }, null)).toBeNull()
    expect(saveChosenSideAsVersion([] as VersionSnapshot[], { id: 'd1', title: 'Doc' }, { type: 'doc' })).toBeNull()
  })
})
