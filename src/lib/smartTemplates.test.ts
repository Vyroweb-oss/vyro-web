import { describe, it, expect } from 'vitest'
import {
  SMART_TEMPLATES, getSmartTemplate, blankSmartValues, validateSmartForm,
  substitutePlaceholders, sectionChecklist, incompleteSections, createSmartDocument,
  duplicateSmartTemplate, loadSmartCopies, saveSmartCopies, SMART_COPIES_KEY,
} from './smartTemplates'

const dari = SMART_TEMPLATES.find(t => t.id === 'smart-dari-letter')!
const letter = SMART_TEMPLATES.find(t => t.id === 'smart-formal-letter')!
const minutes = SMART_TEMPLATES.find(t => t.id === 'smart-meeting-minutes')!

describe('smart template catalogue', () => {
  it('has EN + FA templates with unique ids, both languages, RTL Dari', () => {
    expect(SMART_TEMPLATES.length).toBeGreaterThanOrEqual(4)
    expect(new Set(SMART_TEMPLATES.map(t => t.id)).size).toBe(SMART_TEMPLATES.length)
    for (const t of SMART_TEMPLATES) {
      expect(t.nameEn.length).toBeGreaterThan(0); expect(t.nameFa.length).toBeGreaterThan(0)
      expect(t.nameFa).not.toBe(t.nameEn); expect(t.descFa).not.toBe(t.descEn)
      expect(t.body.type).toBe('doc'); expect(t.fields.length).toBeGreaterThan(0)
      expect(t.sections.length).toBeGreaterThan(0)
    }
    expect(dari.dir).toBe('rtl'); expect(letter.dir).toBe('ltr')
    expect(SMART_TEMPLATES.some(t => t.dir === 'rtl')).toBe(true)
    expect(SMART_TEMPLATES.some(t => t.dir === 'ltr')).toBe(true)
  })
  it('every field key used by a section exists, and every body placeholder is a known field', () => {
    for (const t of SMART_TEMPLATES) {
      const keys = new Set(t.fields.map(f => f.key))
      for (const s of t.sections) for (const k of s.fieldKeys) expect(keys.has(k), `${t.id} section ${s.id} key ${k}`).toBe(true)
      const bodyText = JSON.stringify(t.body)
      for (const m of bodyText.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) expect(keys.has(m[1]), `${t.id} placeholder ${m[1]}`).toBe(true)
    }
  })
})

describe('placeholder substitution', () => {
  it('substitutes EN values and leaves no known placeholder behind', () => {
    const out = substitutePlaceholders(letter.body, letter, { senderName: 'Ahmad', senderAddress: 'Kabul', date: '2026-10-30', recipientName: 'Sara', subject: 'Leave request', referenceNumber: '42' })
    const text = JSON.stringify(out)
    expect(text).toContain('Ahmad'); expect(text).toContain('Leave request'); expect(text).toContain('42')
    expect(text).not.toMatch(/\{\{/)
  })
  it('substitutes Dari values preserving ZWNJ byte-for-byte', () => {
    const value = 'می‌خواهم' // contains U+200C ZWNJ
    const out = substitutePlaceholders(dari.body, dari, { fullName: value, date: '۱۴۰۵/۰۸/۰۸', recipient: 'ریاست محترم', subject: 'درخواست مرخصی', referenceNumber: '' })
    const text = JSON.stringify(out)
    expect(text).toContain('می‌خواهم')
    expect(text).not.toContain('\u200d') // no ZWJ introduced
    expect(text).not.toMatch(/\{\{fullName\}\}/)
  })
  it('blank optional field becomes empty text, unknown placeholder stays intact', () => {
    const body = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ref: {{referenceNumber}} and {{mystery}}' }] }] }
    const out = substitutePlaceholders(letter.body && body, letter, { referenceNumber: '' })
    expect(JSON.stringify(out)).toContain('Ref:  and {{mystery}}')
  })
  it('never mutates the template body', () => {
    const before = JSON.stringify(dari.body)
    substitutePlaceholders(dari.body, dari, { fullName: 'X', date: 'Y', recipient: 'Z', subject: 'S', referenceNumber: '1' })
    expect(JSON.stringify(dari.body)).toBe(before)
  })
})

describe('validation (error paths)', () => {
  it('missing required fields are reported, no document is created', () => {
    const v = validateSmartForm(letter, blankSmartValues(letter))
    expect(v.ok).toBe(false)
    expect(v.missing).toContain('senderName'); expect(v.missing).toContain('subject')
    expect(v.missing).not.toContain('referenceNumber') // optional
    const res = createSmartDocument(letter, blankSmartValues(letter))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.missing.length).toBeGreaterThan(0)
  })
  it('a number field with no digit at all is invalid; Persian digits pass', () => {
    expect(validateSmartForm(letter, { ...blankSmartValues(letter), senderName: 'A', date: 'D', recipientName: 'B', subject: 'S', referenceNumber: 'abc' }).invalid).toContain('referenceNumber')
    expect(validateSmartForm(dari, { ...blankSmartValues(dari), fullName: 'احمد', date: '۱۴۰۵', recipient: 'ریاست', subject: 'موضوع', referenceNumber: '۱۲۳' }).ok).toBe(true)
  })
  it('a fully valid form passes', () => {
    expect(validateSmartForm(letter, { senderName: 'A', senderAddress: '', date: '2026-10-30', recipientName: 'B', subject: 'S', referenceNumber: '' }).ok).toBe(true)
  })
})

describe('reset, checklist, document creation', () => {
  it('reset restores blanks for every field', () => {
    const filled = { senderName: 'A', senderAddress: 'K', date: 'D', recipientName: 'B', subject: 'S', referenceNumber: '7' }
    expect(blankSmartValues(letter)).toEqual({ senderName: '', senderAddress: '', date: '', recipientName: '', subject: '', referenceNumber: '' })
    expect(filled.senderName).toBe('A') // filled form untouched by blankSmartValues
  })
  it('checklist: required sections incomplete until their fields are filled; editor sections are distinct', () => {
    const blank = sectionChecklist(minutes, blankSmartValues(minutes))
    const details = blank.find(c => c.section.id === 'details')!
    expect(details.status).toBe('incomplete')
    expect(blank.find(c => c.section.id === 'decisions')!.status).toBe('editor')
    const filled = sectionChecklist(minutes, { meetingTitle: 'M', date: 'D', location: '', chairperson: 'C', recorder: '' })
    expect(filled.find(c => c.section.id === 'details')!.status).toBe('complete')
    expect(filled.find(c => c.section.id === 'chair')!.status).toBe('complete')
    expect(incompleteSections(minutes, blankSmartValues(minutes)).map(s => s.id)).toContain('details')
    expect(incompleteSections(minutes, blankSmartValues(minutes)).map(s => s.id)).not.toContain('decisions')
    expect(incompleteSections(minutes, { meetingTitle: 'M', date: 'D', location: '', chairperson: 'C', recorder: '' })).toEqual([])
  })
  it('creates a real editable TipTap doc with substituted content and a subject title', () => {
    const res = createSmartDocument(dari, { fullName: 'احمد محمدی', date: '۱۴۰۵/۰۸/۰۸', recipient: 'ریاست محترم', subject: 'درخواست مرخصی', referenceNumber: '۹۹' })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(res.content.type).toBe('doc')
    expect(JSON.stringify(res.content)).toContain('احمد محمدی')
    expect(JSON.stringify(res.content)).toContain('درخواست مرخصی')
    expect(res.title).toContain('درخواست مرخصی')
  })
  it('no cross-document leakage: two creations from one template keep their own values', () => {
    const a = createSmartDocument(letter, { senderName: 'Alice', senderAddress: '', date: 'D1', recipientName: 'Bob', subject: 'First', referenceNumber: '' })
    const b = createSmartDocument(letter, { senderName: 'Carol', senderAddress: '', date: 'D2', recipientName: 'Dan', subject: 'Second', referenceNumber: '' })
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) throw new Error('expected ok')
    expect(JSON.stringify(a.content)).toContain('Alice'); expect(JSON.stringify(a.content)).not.toContain('Carol')
    expect(JSON.stringify(b.content)).toContain('Carol'); expect(JSON.stringify(b.content)).not.toContain('Alice')
    expect(JSON.stringify(letter.body)).not.toContain('Alice')
  })
})

describe('duplicate + personal copies', () => {
  it('duplicate gets a new id and is independent of the original', () => {
    const copy = duplicateSmartTemplate(dari, 'personal-x')
    expect(copy.id).toBe('personal-x'); expect(copy.personal).toBe(true)
    expect(dari.personal).toBeFalsy()
    copy.body.content[0].content[0].text = 'MUTATED'
    copy.fields[0].labelEn = 'MUTATED'
    expect(JSON.stringify(dari.body)).not.toContain('MUTATED')
    expect(dari.fields[0].labelEn).not.toBe('MUTATED')
  })
  it('personal copies round-trip through storage; corrupt payload yields []', () => {
    const m = new Map<string, string>()
    const fake = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } }
    expect(loadSmartCopies(fake as any)).toEqual([])
    const copy = duplicateSmartTemplate(letter, 'personal-y')
    expect(saveSmartCopies(fake as any, [copy])).toBe(true)
    const back = loadSmartCopies(fake as any)
    expect(back.length).toBe(1); expect(back[0].id).toBe('personal-y'); expect(back[0].body.type).toBe('doc')
    expect(getSmartTemplate('personal-y', back)?.id).toBe('personal-y')
    m.set(SMART_COPIES_KEY, 'not-json{')
    expect(loadSmartCopies(fake as any)).toEqual([])
    m.set(SMART_COPIES_KEY, JSON.stringify([{ id: 42 }]))
    expect(loadSmartCopies(fake as any)).toEqual([])
  })
})
