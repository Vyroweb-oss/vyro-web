// Gate policy (owner decision, 2026-11-03): EVERY feature is free for
// everyone. No premium gate remains anywhere:
// - Printing / browser Save-as-PDF: free at every entry point (as since 2026-10-31).
// - DOCX export: free, at both entry points, no lock mark.
// - Custom templates: free, opens directly.
// - Cloud documents: the sync engine activates for any signed-in user
//   (the server-side gate was opened the same day; owner checks still apply).
// These are source-level guards: the gates live in JSX handlers, so the
// tests pin the wiring itself — a future edit that re-gates any feature
// fails here before it can ship.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { STRINGS } from './i18n'
const en = STRINGS.en
const fa = STRINGS.fa

import { resolve } from 'node:path'
const editorSrc = readFileSync(resolve(process.cwd(), 'src/components/Editor.tsx'), 'utf8')
const appSrc = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
const cloudSrc = readFileSync(resolve(process.cwd(), 'src/components/useCloudSync.ts'), 'utf8')

describe('print/PDF is free at every in-app entry point', () => {
  it('no print call site is wrapped in a premium gate', () => {
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

describe('no premium gates remain (owner decision 2026-11-03)', () => {
  it('DOCX export is ungated at BOTH entry points and has no lock mark', () => {
    expect(editorSrc).not.toContain('gated(')
    expect(editorSrc).not.toContain('🔒')
    const directDocx = editorSrc.match(/exportDocx\(editor\.getJSON\(\), doc\.title\)/g) ?? []
    expect(directDocx.length).toBe(2)
  })
  it('custom templates open directly, with no premium check and no lock label', () => {
    expect(appSrc).toContain("const openCustomTemplate=()=>{ setTplName(''); setTplModal(true) }")
    expect(appSrc).not.toContain('if(!isPremium){ setShowPremium(true); return }')
    expect(appSrc).not.toContain('premiumLock')
  })
  it('the cloud sync engine activates for any signed-in user', () => {
    expect(cloudSrc).toContain('const active = isCloudDocsEnabled && isSupabaseConfigured && !!accountId')
    expect(cloudSrc).not.toContain('&& isPremium')
  })
  it('import stays ungated (file picker opens directly)', () => {
    expect(editorSrc).toContain('importRef.current?.click()')
    expect(editorSrc).not.toContain('gated(()=>importRef')
  })
})

describe('interface text tells the truth about the policy (EN + FA)', () => {
  it('EN copy states every feature is free for everyone', () => {
    expect(en.premiumDesc).toContain('free for everyone')
    expect(en.premiumDesc).toContain('DOCX export and custom templates')
    expect(en.premiumDesc).toContain('No subscription is needed')
  })
  it('FA copy matches: everything free for everyone, no subscription needed', () => {
    expect(fa.premiumDesc).toContain('خروجی DOCX و الگوهای سفارشی')
    expect(fa.premiumDesc).toContain('برای همه رایگان است')
    expect(fa.premiumDesc).toContain('هیچ اشتراکی لازم نیست')
  })
})
