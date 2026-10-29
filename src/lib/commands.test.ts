import { describe, it, expect, vi } from 'vitest'
import {
  buildCommands, filterCommands, isPaletteShortcut, loadRecentCommands,
  matchesCommand, normalizeSearch, recordRecentCommand,
  RECENT_COMMANDS_KEY, MAX_RECENT_COMMANDS, type PaletteCommand,
} from './commands'
import { TEMPLATES } from './templates'

const fakeStorage = () => {
  const m = new Map<string, string>()
  return { m, store: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } } }
}
const cmd = (id: string, title: string): PaletteCommand => ({ id, title: () => title, run: () => {} })

describe('normalizeSearch', () => {
  it('lower-cases and maps Arabic letters to Persian', () => {
    expect(normalizeSearch('كتاب ي')).toBe('کتابی')
    expect(normalizeSearch('EXPORT')).toBe('export')
  })
  it('strips ZWNJ so typed and displayed Persian match', () => {
    expect(normalizeSearch('نامه\u200cرسمی')).toBe(normalizeSearch('نامه رسمی'))
    expect(normalizeSearch('نامهٔ')).toBe(normalizeSearch('نامه'))
  })
})

describe('matchesCommand / filterCommands', () => {
  it('substring, case-insensitive, and fuzzy subsequence matches', () => {
    expect(matchesCommand('Export HTML', 'html')).toBe(true)
    expect(matchesCommand('Export HTML', 'EXPO')).toBe(true)
    expect(matchesCommand('Export HTML', 'ehtml')).toBe(true) // subsequence
    expect(matchesCommand('Export HTML', 'xyz')).toBe(false)
    expect(matchesCommand('Export HTML', '')).toBe(true)
  })
  it('Persian query with Arabic letters matches a Persian title', () => {
    expect(matchesCommand('نامهٔ رسمی', 'نامه رسمي')).toBe(true)
  })
  it('substring matches rank before fuzzy matches, order kept within rank', () => {
    // 'High Template List' matches 'html' only as a subsequence (h…t…m…l);
    // 'HTML Export' contains it as a substring, so it must rank first.
    const cmds = [cmd('fuzzy', 'High Template List'), cmd('sub', 'HTML Export'), cmd('none', 'Zoom in')]
    expect(filterCommands(cmds, 'html', 'en').map((c) => c.id)).toEqual(['sub', 'fuzzy'])
    expect(filterCommands(cmds, '', 'en')).toHaveLength(3)
  })
})

describe('isPaletteShortcut guard', () => {
  it('only the Ctrl/Cmd+K chord on the physical K key opens the palette', () => {
    expect(isPaletteShortcut({ code: 'KeyK', ctrlKey: true, metaKey: false })).toBe(true)
    expect(isPaletteShortcut({ code: 'KeyK', ctrlKey: false, metaKey: true })).toBe(true)
    expect(isPaletteShortcut({ code: 'KeyK', ctrlKey: false, metaKey: false })).toBe(false) // plain typing
    expect(isPaletteShortcut({ code: 'KeyA', ctrlKey: true, metaKey: false })).toBe(false)
    expect(isPaletteShortcut({ code: 'KeyK', ctrlKey: true, metaKey: false, altKey: true })).toBe(false)
  })
})

describe('recent commands', () => {
  it('records newest-first, de-duplicates, and caps at the limit', () => {
    const { m, store } = fakeStorage()
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) recordRecentCommand(store as any, id)
    expect(loadRecentCommands(store as any)).toEqual(['f', 'e', 'd', 'c', 'b'])
    expect(loadRecentCommands(store as any)).toHaveLength(MAX_RECENT_COMMANDS)
    recordRecentCommand(store as any, 'e')
    expect(loadRecentCommands(store as any)[0]).toBe('e')
    expect(m.get(RECENT_COMMANDS_KEY)).toContain('"e"')
  })
  it('tolerates missing and corrupt stored values', () => {
    const { store } = fakeStorage()
    expect(loadRecentCommands(store as any)).toEqual([])
    const bad = { getItem: () => 'not-json' }
    expect(loadRecentCommands(bad as any)).toEqual([])
  })
})

describe('buildCommands registry', () => {
  const base = {
    createBlank: vi.fn(), createFromTemplate: vi.fn(), goDashboard: vi.fn(),
    toggleTheme: vi.fn(), toggleLanguage: vi.fn(), theme: 'light', lang: 'en' as const,
    templates: TEMPLATES,
  }
  it('dashboard context has no editor-only commands', () => {
    const ids = buildCommands(base).map((c) => c.id)
    expect(ids).toContain('new-document')
    expect(ids).toContain('toggle-theme')
    expect(ids).toContain('toggle-language')
    expect(ids).toContain('go-dashboard')
    expect(ids).toContain('template:formal-letter')
    expect(ids).not.toContain('insert-table')
    expect(ids).not.toContain('export-txt')
    expect(ids).not.toContain('zoom-in')
  })
  it('editor context adds exactly the provided editor commands, ids unique', () => {
    const cmds = buildCommands({ ...base, insertTable: vi.fn(), insertDate: vi.fn(), exportTxt: vi.fn(), exportHtml: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn(), zoomReset: vi.fn() })
    const ids = cmds.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ['insert-table', 'insert-date', 'export-txt', 'export-html', 'zoom-in', 'zoom-out', 'zoom-reset']) expect(ids).toContain(id)
  })
  it('every template is a command and titles resolve in both languages', () => {
    const cmds = buildCommands(base)
    expect(cmds.filter((c) => c.id.startsWith('template:'))).toHaveLength(TEMPLATES.length)
    const dari = cmds.find((c) => c.id === 'template:dari-letter')!
    expect(dari.title('fa')).not.toBe(dari.title('en'))
  })
  it('running a command calls its real action', () => {
    const run = vi.fn()
    const cmds = buildCommands({ ...base, insertTable: run })
    cmds.find((c) => c.id === 'insert-table')!.run()
    expect(run).toHaveBeenCalledTimes(1)
  })
})
