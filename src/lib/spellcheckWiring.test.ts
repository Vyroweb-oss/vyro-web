// Tier-1 S3: spellcheck wiring guards.
// - The editor advertises the document language to the browser via the
//   `lang` attribute (initial attributes AND the live-update effect), so
//   the browser's own checker uses the right dictionary.
// - The Review toggle persists through Settings (onSettingsChange) instead
//   of living in throwaway component state.
// This stage adds NO spelling engine and NO dictionary — it only wires the
// browser's existing behaviour; these guards pin that wiring.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const editorSrc = readFileSync(resolve(process.cwd(), 'src/components/Editor.tsx'), 'utf8')

describe('Tier-1 S3: editor language + spellcheck wiring', () => {
  it('the editor DOM gets lang from languageTagForDir(doc.dir) at init and on updates', () => {
    expect(editorSrc).toContain('lang: languageTagForDir(doc.dir)')
    expect(editorSrc).toContain("setAttribute('lang', languageTagForDir(doc.dir))")
    expect(editorSrc).toContain("setAttribute('dir', doc.dir)")
  })
  it('the toggle persists via onSettingsChange and seeds from settings', () => {
    expect(editorSrc).toContain('settings?.spellcheck ?? true')
    expect(editorSrc).toContain("onSettingsChange?.({ spellcheck: next })")
    expect(editorSrc).toContain('onClick={toggleSpell}')
    expect(editorSrc).not.toContain('onClick={()=>setSpell(s=>!s)}')
  })
  it('the attribute effect still maintains spellcheck + dir together with lang', () => {
    expect(editorSrc).toContain("setAttribute('spellcheck', String(spell))")
  })
})
