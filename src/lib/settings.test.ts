import { describe, it, expect } from 'vitest'
import {
  SETTINGS_KEY, DEFAULT_SETTINGS, defaultSettings, sanitizeSettings, loadSettings, saveSettings,
  resolveTheme, resolveAutosaveDelay, uiSizeClass, newDocDir, applyNewDocDefaults,
} from './settings'

function fakeStorage(initial?: Record<string, string>) {
  const m = new Map<string, string>(Object.entries(initial ?? {}))
  return {
    map: m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v) },
  }
}

describe('settings defaults', () => {
  it('defaults are the documented values', () => {
    expect(DEFAULT_SETTINGS.uiLang).toBe('en')
    expect(DEFAULT_SETTINGS.uiSize).toBe('comfortable')
    expect(DEFAULT_SETTINGS.writingWidth).toBe('normal')
    expect(DEFAULT_SETTINGS.toolbar).toBe('full')
    expect(DEFAULT_SETTINGS.theme).toBe('light')
    expect(DEFAULT_SETTINGS.defaultDir).toBe('ltr')
    expect(DEFAULT_SETTINGS.defaultFont).toBe('Vazirmatn')
    expect(DEFAULT_SETTINGS.defaultFontSize).toBe(16)
    expect(DEFAULT_SETTINGS.autosaveEnabled).toBe(true)
    expect(DEFAULT_SETTINGS.autosaveIntervalMs).toBe(500)
  })
  it('defaultSettings returns a fresh copy (mutating it does not poison defaults)', () => {
    const a = defaultSettings(); a.uiSize = 'large'; a.autosaveIntervalMs = 9999
    expect(defaultSettings().uiSize).toBe('comfortable')
    expect(DEFAULT_SETTINGS.autosaveIntervalMs).toBe(500)
  })
})

describe('settings load/save', () => {
  it('round-trips through storage', () => {
    const s = fakeStorage()
    const mine = { ...defaultSettings(), uiLang: 'fa' as const, uiSize: 'large' as const, theme: 'system' as const, autosaveIntervalMs: 2000 }
    expect(saveSettings(s as any, mine)).toBe(true)
    expect(loadSettings(s as any)).toEqual(mine)
    expect(s.map.get(SETTINGS_KEY)).toContain('"system"')
  })
  it('empty storage yields defaults', () => {
    expect(loadSettings(fakeStorage() as any)).toEqual(defaultSettings())
  })
  it('corrupt JSON never throws and yields defaults', () => {
    const s = fakeStorage({ [SETTINGS_KEY]: '{not json' })
    expect(() => loadSettings(s as any)).not.toThrow()
    expect(loadSettings(s as any)).toEqual(defaultSettings())
  })
  it('non-object stored values (array, string, number) yield defaults', () => {
    for (const bad of ['[]', '"x"', '42', 'null']) {
      expect(loadSettings(fakeStorage({ [SETTINGS_KEY]: bad }) as any)).toEqual(defaultSettings())
    }
  })
  it('invalid fields fall back individually while valid fields survive', () => {
    const stored = {
      uiLang: 'fa', // valid
      uiSize: 'huge', // invalid -> comfortable
      theme: 'blue', // invalid -> light
      writingWidth: 'wide', // valid
      toolbar: 'compact', // valid
      defaultFont: 'Comic Sans', // not an editor font -> Vazirmatn
      defaultFontSize: 999, // not an offered size -> 16
      autosaveEnabled: 'yes', // not a boolean -> true
      autosaveIntervalMs: -50, // clamped to 250
      mysteryKey: 'ignored',
    }
    const s = fakeStorage({ [SETTINGS_KEY]: JSON.stringify(stored) })
    const got = loadSettings(s as any)
    expect(got.uiLang).toBe('fa')
    expect(got.uiSize).toBe('comfortable')
    expect(got.theme).toBe('light')
    expect(got.writingWidth).toBe('wide')
    expect(got.toolbar).toBe('compact')
    expect(got.defaultFont).toBe('Vazirmatn')
    expect(got.defaultFontSize).toBe(16)
    expect(got.autosaveEnabled).toBe(true)
    expect(got.autosaveIntervalMs).toBe(250)
    expect((got as any).mysteryKey).toBeUndefined()
  })
  it('interval above the cap clamps to 10000', () => {
    const got = sanitizeSettings({ autosaveIntervalMs: 60000 })
    expect(got.autosaveIntervalMs).toBe(10000)
  })
  it('storage errors never throw (blocked getItem / setItem)', () => {
    expect(loadSettings({ getItem: () => { throw new Error('blocked') } } as any)).toEqual(defaultSettings())
    expect(saveSettings({ setItem: () => { throw new Error('full') } } as any, defaultSettings())).toBe(false)
  })
  it('legacy theme + language seed a first run with no settings record', () => {
    const s = fakeStorage({ 'vyro-web-theme': 'dark', 'vyro-web-ui-lang': 'fa' })
    const got = loadSettings(s as any)
    expect(got.theme).toBe('dark')
    expect(got.uiLang).toBe('fa')
    // …but an explicit settings record always wins over legacy keys.
    const s2 = fakeStorage({ 'vyro-web-theme': 'dark', 'vyro-web-ui-lang': 'fa', [SETTINGS_KEY]: JSON.stringify({ theme: 'light', uiLang: 'en' }) })
    const got2 = loadSettings(s2 as any)
    expect(got2.theme).toBe('light')
    expect(got2.uiLang).toBe('en')
  })
  it('legacy garbage (theme "system" in the old key) is ignored', () => {
    const s = fakeStorage({ 'vyro-web-theme': 'system' })
    expect(loadSettings(s as any).theme).toBe('light')
  })
})

describe('follow-system theme resolution', () => {
  it('system follows the OS boolean, explicit choices override it', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
  })
})

describe('autosave delay resolution', () => {
  it('off yields null (no background timer); on yields the clamped interval', () => {
    expect(resolveAutosaveDelay({ ...defaultSettings(), autosaveEnabled: false, autosaveIntervalMs: 1000 })).toBeNull()
    expect(resolveAutosaveDelay({ ...defaultSettings(), autosaveEnabled: true, autosaveIntervalMs: 2000 })).toBe(2000)
    expect(resolveAutosaveDelay({ ...defaultSettings(), autosaveEnabled: true, autosaveIntervalMs: 1 })).toBe(250)
  })
})

describe('ui size class', () => {
  it('comfortable adds no class; compact/large add their class', () => {
    expect(uiSizeClass('comfortable')).toBe('')
    expect(uiSizeClass('compact')).toBe('ui-size-compact')
    expect(uiSizeClass('large')).toBe('ui-size-large')
  })
})

describe('new-document defaults', () => {
  it('blank docs take the default direction; templates keep their own', () => {
    expect(newDocDir('ltr', true, 'rtl')).toBe('rtl')
    expect(newDocDir('rtl', false, 'ltr')).toBe('rtl')
    expect(newDocDir('ltr', false, 'rtl')).toBe('ltr')
  })
  it('applyNewDocDefaults adds font/size marks to text nodes without overwriting existing formatting', () => {
    const content = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Bold', marks: [{ type: 'bold' }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Styled', marks: [{ type: 'textStyle', attrs: { fontFamily: 'Georgia' } }] }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nested' }] }] }] },
    ] }
    const settings = { ...defaultSettings(), defaultFont: 'Tahoma', defaultFontSize: 20 }
    const out = applyNewDocDefaults(content, settings) as any
    const texts = JSON.stringify(out)
    expect(out.content[0].content[0].marks).toEqual([{ type: 'textStyle', attrs: { fontFamily: 'Tahoma', fontSize: '20px' } }])
    // Bold mark preserved, style mark added alongside it.
    expect(out.content[1].content[0].marks).toEqual([{ type: 'bold' }, { type: 'textStyle', attrs: { fontFamily: 'Tahoma', fontSize: '20px' } }])
    // Existing font kept, missing size filled in.
    expect(out.content[2].content[0].marks).toEqual([{ type: 'textStyle', attrs: { fontFamily: 'Georgia', fontSize: '20px' } }])
    // Nested list text reached too.
    expect(out.content[3].content[0].content[0].content[0].marks[0].attrs.fontFamily).toBe('Tahoma')
    expect(texts).toContain('Hello')
    // Input not mutated.
    expect((content.content[0] as any).content[0].marks).toBeUndefined()
  })
  it('blank content (no text nodes) comes back unchanged, and non-doc input passes through', () => {
    const blank = { type: 'doc', content: [{ type: 'paragraph' }] }
    expect(applyNewDocDefaults(blank, defaultSettings())).toEqual(blank)
    expect(applyNewDocDefaults(null, defaultSettings())).toBeNull()
    expect(applyNewDocDefaults('x', defaultSettings())).toBe('x')
  })
})

describe('Tier-1 S3: spellcheck setting', () => {
  it('defaults to true (the pre-S3 behaviour)', () => {
    expect(defaultSettings().spellcheck).toBe(true)
    expect(loadSettings(fakeStorage() as any).spellcheck).toBe(true)
  })
  it('round-trips false and true through storage', () => {
    const s = fakeStorage()
    expect(saveSettings(s as any, { ...defaultSettings(), spellcheck: false })).toBe(true)
    expect(loadSettings(s as any).spellcheck).toBe(false)
    expect(saveSettings(s as any, { ...defaultSettings(), spellcheck: true })).toBe(true)
    expect(loadSettings(s as any).spellcheck).toBe(true)
  })
  it('a legacy record without the field, or a corrupt value, falls back to true', () => {
    const legacy = fakeStorage({ [SETTINGS_KEY]: JSON.stringify({ uiLang: 'en', theme: 'dark' }) })
    expect(loadSettings(legacy as any).spellcheck).toBe(true)
    const corrupt = fakeStorage({ [SETTINGS_KEY]: JSON.stringify({ spellcheck: 'yes' }) })
    expect(loadSettings(corrupt as any).spellcheck).toBe(true)
  })
})
