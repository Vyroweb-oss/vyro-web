import { describe, it, expect } from 'vitest'
import {
  parseCsv,
  extractPlaceholders,
  missingFields,
  substituteDoc,
  clampRecordIndex,
  navRecordIndex,
  MAIL_MERGE_MAX_RECORDS,
} from './mailMerge'

const doc = (texts: string[]) => ({
  type: 'doc',
  content: texts.map((text) => ({
    type: 'paragraph',
    content: [{ type: 'text', text }],
  })),
})

describe('mailMerge CSV parser', () => {
  it('parses quoted commas', () => {
    const r = parseCsv('Name,City\n"Ahmad, Jr",Kabul')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.fields).toEqual(['Name', 'City'])
    expect(r.records).toEqual([{ Name: 'Ahmad, Jr', City: 'Kabul' }])
  })
  it('parses quoted quotes ("" escape)', () => {
    const r = parseCsv('Name\n"He said ""hello"""')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.records[0].Name).toBe('He said "hello"')
  })
  it('parses CRLF and embedded newlines in quoted fields', () => {
    const r = parseCsv('Name,Note\r\nAhmad,"line one\r\nline two"\r\nSara,hi')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.records).toHaveLength(2)
    expect(r.records[0].Note).toBe('line one\r\nline two')
    expect(r.records[1].Name).toBe('Sara')
  })
  it('skips empty lines and trims unquoted values', () => {
    const r = parseCsv('Name,City\n\nAhmad, Kabul\n   \nSara,Herat\n')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.records).toEqual([
      { Name: 'Ahmad', City: 'Kabul' },
      { Name: 'Sara', City: 'Herat' },
    ])
  })
  it('errors on empty CSV', () => {
    expect(parseCsv('')).toEqual({ ok: false, error: 'empty' })
    expect(parseCsv('\n\n  \n')).toEqual({ ok: false, error: 'empty' })
  })
  it('errors on duplicate headers', () => {
    const r = parseCsv('Name,Name\nAhmad,Sara')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toBe('duplicateHeader')
    expect(r.detail).toBe('Name')
  })
  it('errors on blank headers', () => {
    const r = parseCsv('Name,,City\nAhmad,x,Kabul')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toBe('blankHeader')
  })
  it('errors on unterminated quotes', () => {
    const r = parseCsv('Name\n"unclosed')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toBe('unterminatedQuote')
  })
  it('caps records at 200', () => {
    const rows = ['Name', ...Array.from({ length: MAIL_MERGE_MAX_RECORDS }, (_, i) => `Person ${i}`)].join('\n')
    expect(parseCsv(rows).ok).toBe(true)
    const over = rows + '\nOne too many'
    const r = parseCsv(over)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toBe('tooManyRecords')
  })
})

describe('mailMerge substitution', () => {
  it('substitutes placeholders over text nodes only, preserving non-text nodes', () => {
    const input = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Dear {{Name}}, welcome to {{City}}!' }] },
        { type: 'image', attrs: { src: 'data:x', alt: '{{Name}} must stay' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'See you, {{Name}}.' }] },
      ],
    }
    const before = JSON.stringify(input)
    const { doc: out, unsubstituted } = substituteDoc(input, { Name: 'Ahmad' })
    expect(JSON.stringify(input)).toBe(before)
    expect(unsubstituted).toEqual(['City'])
    expect(out.content[0].content[0].text).toBe('Dear Ahmad, welcome to {{City}}!')
    expect(out.content[1]).toEqual({ type: 'image', attrs: { src: 'data:x', alt: '{{Name}} must stay' } })
    expect(out.content[2].content[0].text).toBe('See you, Ahmad.')
  })
  it('reports missing fields and leaves them unsubstituted per record', () => {
    const d = doc(['Hello {{Name}} from {{City}}'])
    expect(extractPlaceholders(d)).toEqual(['Name', 'City'])
    expect(missingFields(d, ['Name'])).toEqual(['City'])
    const { doc: out, unsubstituted } = substituteDoc(d, { Name: 'Sara' })
    expect(out.content[0].content[0].text).toBe('Hello Sara from {{City}}')
    expect(unsubstituted).toEqual(['City'])
  })
  it('does not mutate the original JSON', () => {
    const d = doc(['{{Name}}'])
    const snapshot = JSON.stringify(d)
    substituteDoc(d, { Name: 'Ahmad' })
    expect(JSON.stringify(d)).toBe(snapshot)
  })
  it('handles whitespace inside placeholders and ignores empty ones', () => {
    const d = doc(['{{ Name }} and {{}}'])
    expect(extractPlaceholders(d)).toEqual(['Name'])
    const { doc: out } = substituteDoc(d, { Name: 'Ahmad' })
    expect(out.content[0].content[0].text).toBe('Ahmad and {{}}')
  })
})

describe('Tier-1 S4b: record navigation helpers', () => {
  it('clampRecordIndex bounds and empty-set behaviour', () => {
    expect(clampRecordIndex(0, 0)).toBe(0)
    expect(clampRecordIndex(5, 0)).toBe(0)
    expect(clampRecordIndex(-3, 4)).toBe(0)
    expect(clampRecordIndex(99, 4)).toBe(3)
    expect(clampRecordIndex(2, 4)).toBe(2)
    expect(clampRecordIndex(1.9, 4)).toBe(1)
  })
  it('navRecordIndex walks and stops at both boundaries', () => {
    expect(navRecordIndex(0, 3, 'prev')).toBe(0)
    expect(navRecordIndex(0, 3, 'next')).toBe(1)
    expect(navRecordIndex(1, 3, 'next')).toBe(2)
    expect(navRecordIndex(2, 3, 'next')).toBe(2)
    expect(navRecordIndex(2, 3, 'prev')).toBe(1)
    expect(navRecordIndex(2, 3, 'first')).toBe(0)
    expect(navRecordIndex(0, 3, 'last')).toBe(2)
    expect(navRecordIndex(0, 1, 'next')).toBe(0)
    expect(navRecordIndex(0, 0, 'next')).toBe(0)
    expect(navRecordIndex(0, 0, 'last')).toBe(0)
    // a stale index (record set shrank) is clamped before navigating
    expect(navRecordIndex(9, 3, 'prev')).toBe(1)
    expect(navRecordIndex(9, 3, 'next')).toBe(2)
  })
})
