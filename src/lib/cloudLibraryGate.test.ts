import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Source guards for the Stage 2D dialog's safety structure. The behavioural
// core (planner, consent, backup) is unit-tested directly; these guards pin
// the wiring that makes the unsafe flows unreachable from the UI:
//  - sends are possible only through the guarded hook call,
//  - the Send button and the checkboxes stay disabled until consent exists
//    AND the session backup has verified,
//  - applying a restore downloads the CURRENT library before replacing it.
const modalSource = readFileSync(resolve(process.cwd(), 'src/components/CloudLibraryModal.tsx'), 'utf8')

describe('CloudLibraryModal safety wiring', () => {
  it('sends go only through cloud.sendToCloud (no direct table access)', () => {
    expect(modalSource).toContain('cloud.sendToCloud(')
    expect(modalSource).not.toContain('cloudDocs')
    expect(modalSource).not.toContain('insertDocument')
    expect(modalSource).not.toContain('supabase')
  })

  it('the send gate requires consent AND a verified session backup', () => {
    expect(modalSource).toContain("gate === 'verified'")
    expect(modalSource).toContain('!!cloud.consentAt')
    expect(modalSource).toContain('disabled={!canSend}')
  })

  it('the backup gate verifies a rebuilt backup against the live library', () => {
    expect(modalSource).toContain('verifyRestoredLibrary(')
    expect(modalSource).toContain('buildLibraryBackup(')
  })

  it('restore downloads the current library BEFORE applying the restore', () => {
    const applyAt = modalSource.indexOf('const applyRestore')
    const downloadAt = modalSource.indexOf('downloadCurrentBackup()', applyAt)
    const restoreAt = modalSource.indexOf('onRestore(restoreLibrary(restoreParsed))', applyAt)
    expect(applyAt).toBeGreaterThan(-1)
    expect(downloadAt).toBeGreaterThan(applyAt)
    expect(restoreAt).toBeGreaterThan(downloadAt)
  })

  it('consent is recorded only through the hook (per-account store)', () => {
    expect(modalSource).toContain('cloud.recordConsent()')
    expect(modalSource).not.toContain('cloudConsent')
  })
})
