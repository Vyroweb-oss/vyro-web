import { describe,it,expect } from 'vitest'
import { resolveDir, dirFromLanguage, toggleDir, detectDirFromText, containsRtlScript, languageTagForDir } from './dir'
describe('dir helper',()=>{
 it('resolve',()=>{ expect(resolveDir('rtl')).toBe('rtl'); expect(resolveDir('ltr')).toBe('ltr'); expect(resolveDir(undefined)).toBe('ltr'); expect(resolveDir('xx')).toBe('ltr') })
 it('from language',()=>{ expect(dirFromLanguage('fa')).toBe('rtl'); expect(dirFromLanguage('fa-AF')).toBe('rtl'); expect(dirFromLanguage('en')).toBe('ltr') })
 it('toggle',()=>{ expect(toggleDir('ltr')).toBe('rtl') })
 it('detect Dari',()=>{ expect(containsRtlScript('سلام')).toBe(true); expect(detectDirFromText('سلام دنیا')).toBe('rtl'); expect(detectDirFromText('Hello')).toBe('ltr') })
})

describe('Tier-1 S3: languageTagForDir (documented fallback, not a detector)', () => {
  it('maps rtl documents to fa and ltr documents to en', () => {
    expect(languageTagForDir('rtl')).toBe('fa')
    expect(languageTagForDir('ltr')).toBe('en')
  })
})
