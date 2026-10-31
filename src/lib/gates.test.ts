// Free-vs-Premium gate policy (owner-approved, 2026-10-31):
// - Basic printing / browser Save-as-PDF is FREE for everyone, at EVERY
//   in-app entry point (File ribbon, title-bar File menu, export presets).
// - DOCX export stays Premium-gated; DOCX/TXT import and TXT/HTML export
//   stay free; custom templates stay Premium-gated.
// These are source-level guards: the gates live in JSX handlers, so the
// tests pin the wiring itself — a future edit that re-gates printing (or
// un-gates DOCX) fails here before it can ship.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { STRINGS } from './i18n'
const en = STRINGS.en
const fa = STRINGS.fa

import { resolve } from 'node:path'
const editorSrc = readFileSync(resolve(process.cwd(), 'src/components/Editor.tsx'), 'utf8')
const appSrc = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')

describe('print/PDF is free at every in-app entry point', () => {
  it('no print call site is wrapped in the premium gate', () => {
    expect(editorSrc).not.toContain('gated(()=>window.print())')
    expect(editorSrc).not.toContain("gated(() => window.print())")
  })
  it('the File ribbon Print/PDF button calls window.print directly, with no lock mark', () => {
    expect(editorSrc).toContain("<Btn onClick={()=>window.print()}>{t('printPdf')}</Btn>")
  })
  it('the title-bar File menu Print/PDF item calls window.print directly, with no lock mark', () => {
    expect(editorSrc).toContain("setFileOpen(false); window.print() }}>{t('printPdf')}")
  })
  it('the export presets panel print action is ungated', () => {
    expect(editorSrc).toContain('onPrint={()=>window.print()}')
  })
  it('no lock indicator remains on any print label', () => {
    expect(editorSrc).not.toMatch(/printPdf'\}\)\s*\{!isPremium/)
  })
})

describe('the premium gates that stay', () => {
  it('DOCX export is still gated at BOTH entry points and keeps its lock mark', () => {
    const gatedDocx = editorSrc.match(/gated\(\(\)=>exportDocx/g) ?? []
    expect(gatedDocx.length).toBe(2)
    expect(editorSrc).toContain("{t('exportDocx')} {!isPremium&&'🔒'}")
  })
  it('custom templates still check premium before opening', () => {
    expect(appSrc).toContain('if(!isPremium){ setShowPremium(true); return }')
  })
  it('import stays ungated (file picker opens directly)', () => {
    expect(editorSrc).toContain('importRef.current?.click()')
    expect(editorSrc).not.toContain('gated(()=>importRef')
  })
})

describe('interface text tells the truth about the policy (EN + FA)', () => {
  it('EN premium copy lists only DOCX export + custom templates as unlocks and states print/PDF is free', () => {
    expect(en.premiumDesc).toContain('DOCX export and custom templates')
    expect(en.premiumDesc).toContain('free for everyone')
    expect(en.premiumDesc).not.toContain('Print / PDF, and custom templates')
  })
  it('FA premium copy matches: print/PDF free for everyone, unlocks are DOCX + custom templates', () => {
    expect(fa.premiumDesc).toContain('خروجی DOCX و الگوهای سفارشی')
    expect(fa.premiumDesc).toContain('چاپ پایه و ذخیره به‌صورت PDF برای همه رایگان است')
  })
})
