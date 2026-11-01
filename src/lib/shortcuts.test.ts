import { describe, it, expect } from 'vitest'
import {
  CUSTOM_SHORTCUTS_KEY,
  applyCustomShortcuts,
  assignCustomShortcut,
  chordFromEvent,
  chordsEqual,
  clearCustomShortcut,
  formatChord,
  isCustomizableCommand,
  isModifierCode,
  loadCustomShortcuts,
  matchCustomShortcut,
  saveCustomShortcuts,
  validateChord,
  type CustomShortcutMap,
  type KeyChord,
} from './shortcuts'

function memStorage(initial?: Record<string, string>) {
  const m = new Map<string, string>(Object.entries(initial ?? {}))
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v) },
    _map: m,
  }
}

const ctrlX: KeyChord = { code: 'KeyX', mod: true }
const ctrlShiftX: KeyChord = { code: 'KeyX', mod: true, shift: true }

describe('shortcuts storage', () => {
  it('load/save round-trip preserves chords', () => {
    const s = memStorage()
    const map: CustomShortcutMap = { 'new-document': ctrlShiftX, 'go-dashboard': { code: 'Digit1', mod: true } }
    saveCustomShortcuts(s, map)
    expect(s._map.get(CUSTOM_SHORTCUTS_KEY)).toBe(JSON.stringify(map))
    // Load normalizes missing flags to false.
    expect(loadCustomShortcuts(s)).toEqual({
      'new-document': { code: 'KeyX', mod: true, shift: true, alt: false },
      'go-dashboard': { code: 'Digit1', mod: true, shift: false, alt: false },
    })
  })
  it('corrupt JSON → {} and never throws', () => {
    expect(loadCustomShortcuts(memStorage({ [CUSTOM_SHORTCUTS_KEY]: 'not-json{{' }))).toEqual({})
    expect(loadCustomShortcuts(memStorage({ [CUSTOM_SHORTCUTS_KEY]: '[]' }))).toEqual({})
    expect(loadCustomShortcuts(memStorage({ [CUSTOM_SHORTCUTS_KEY]: '{"a": {"code": 5}}' }))).toEqual({})
    expect(loadCustomShortcuts({ getItem: () => { throw new Error('blocked') } })).toEqual({})
  })
  it('blocked storage on save never throws', () => {
    expect(() => saveCustomShortcuts({ setItem: () => { throw new Error('blocked') } }, { a: ctrlX })).not.toThrow()
  })
  it('shape-valid entries load, malformed entries are dropped', () => {
    const s = memStorage({ [CUSTOM_SHORTCUTS_KEY]: JSON.stringify({ ok: ctrlX, bad: { code: '' }, alsobad: 'x' }) })
    expect(loadCustomShortcuts(s)).toEqual({ ok: { code: 'KeyX', mod: true, shift: false, alt: false } })
  })
})

describe('validateChord', () => {
  it('rejects chords without Ctrl/Cmd', () => {
    expect(validateChord({ code: 'KeyX' }, {}, 'new-document')).toBe('no-mod')
    expect(validateChord({ code: 'KeyX', shift: true }, {}, 'new-document')).toBe('no-mod')
  })
  it('rejects Alt-modified chords', () => {
    expect(validateChord({ code: 'KeyX', mod: true, alt: true }, {}, 'new-document')).toBe('no-mod')
  })
  it('rejects the palette chord Ctrl+K (and Ctrl+Shift+K, which also opens the palette)', () => {
    expect(validateChord({ code: 'KeyK', mod: true }, {}, 'new-document')).toBe('palette')
    expect(validateChord({ code: 'KeyK', mod: true, shift: true }, {}, 'new-document')).toBe('palette')
  })
  it('rejects reserved browser chords, e.g. Ctrl+T', () => {
    expect(validateChord({ code: 'KeyT', mod: true }, {}, 'new-document')).toBe('reserved')
    expect(validateChord({ code: 'KeyF', mod: true }, {}, 'new-document')).toBe('reserved')
  })
  it('rejects builtin catalogue chords, e.g. Ctrl+B', () => {
    expect(validateChord({ code: 'KeyB', mod: true }, {}, 'new-document')).toBe('builtin')
    expect(validateChord({ code: 'KeyZ', mod: true }, {}, 'new-document')).toBe('builtin')
  })
  it('rejects a chord already assigned to another command', () => {
    const map: CustomShortcutMap = { 'go-dashboard': ctrlX }
    expect(validateChord(ctrlX, map, 'new-document')).toBe('duplicate')
    // Re-assigning the same chord to the same command is fine.
    expect(validateChord(ctrlX, map, 'go-dashboard')).toBeNull()
  })
  it('accepts a free Ctrl/Cmd chord', () => {
    expect(validateChord(ctrlX, {}, 'new-document')).toBeNull()
    expect(validateChord(ctrlShiftX, {}, 'new-document')).toBeNull()
    expect(validateChord({ code: 'Digit1', mod: true }, {}, 'new-document')).toBeNull()
  })
  it('assignCustomShortcut persists only on success', () => {
    const { map, error } = assignCustomShortcut({}, 'new-document', ctrlX)
    expect(error).toBeNull()
    expect(map).toEqual({ 'new-document': { code: 'KeyX', mod: true, shift: false, alt: false } })
    const rejected = assignCustomShortcut(map, 'go-dashboard', ctrlX)
    expect(rejected.error).toBe('duplicate')
    expect(rejected.map).toBe(map)
  })
  it('clearCustomShortcut removes only that command', () => {
    expect(clearCustomShortcut({ a: ctrlX, b: ctrlShiftX }, 'a')).toEqual({ b: ctrlShiftX })
  })
})

describe('matching and formatting', () => {
  it('matches by code, not key (Persian layout proof)', () => {
    const map: CustomShortcutMap = { 'new-document': ctrlShiftX }
    // Same physical key, non-Latin key value — still matches.
    expect(matchCustomShortcut(map, { code: 'KeyX', ctrlKey: true, metaKey: false, shiftKey: true })).toBe('new-document')
    expect(matchCustomShortcut(map, { code: 'KeyX', ctrlKey: true, metaKey: false, shiftKey: false })).toBeNull()
    expect(matchCustomShortcut(map, { code: 'KeyY', ctrlKey: true, metaKey: false, shiftKey: true })).toBeNull()
    expect(matchCustomShortcut(map, { code: 'KeyX', ctrlKey: false, metaKey: true, shiftKey: true })).toBe('new-document')
  })
  it('formatChord labels', () => {
    expect(formatChord(ctrlShiftX)).toBe('Ctrl+Shift+X')
    expect(formatChord({ code: 'Digit1', mod: true })).toBe('Ctrl+1')
    expect(formatChord({ code: 'Enter', mod: true })).toBe('Ctrl+Enter')
    expect(formatChord({ code: 'Space', mod: true })).toBe('Ctrl+Space')
    expect(formatChord({ code: 'ArrowDown', mod: true })).toBe('Ctrl+ArrowDown')
    expect(formatChord({ code: 'KeyK', mod: true })).toBe('Ctrl+K')
  })
  it('chordFromEvent builds a code-based chord', () => {
    expect(chordFromEvent({ code: 'KeyX', ctrlKey: false, metaKey: true, shiftKey: true })).toEqual(
      { code: 'KeyX', mod: true, shift: true, alt: false },
    )
  })
  it('chordsEqual treats missing flags as false', () => {
    expect(chordsEqual({ code: 'KeyX', mod: true }, { code: 'KeyX', mod: true, shift: false, alt: false })).toBe(true)
    expect(chordsEqual(ctrlX, ctrlShiftX)).toBe(false)
  })
  it('isModifierCode spots bare modifier keys', () => {
    expect(isModifierCode('ControlLeft')).toBe(true)
    expect(isModifierCode('MetaRight')).toBe(true)
    expect(isModifierCode('KeyX')).toBe(false)
  })
})

describe('applyCustomShortcuts', () => {
  it('overlays custom labels and leaves unassigned commands unchanged (same object)', () => {
    const a = { id: 'new-document', title: () => 'New' }
    const b = { id: 'go-dashboard', title: () => 'Dashboard', shortcut: 'old' }
    const out = applyCustomShortcuts([a, b], { 'new-document': ctrlShiftX })
    expect(out[0]).toEqual({ ...a, shortcut: 'Ctrl+Shift+X' })
    expect(out[1]).toBe(b)
  })
  it('dynamic go-to-heading ids are excluded from customization', () => {
    expect(isCustomizableCommand('go-to-heading:0')).toBe(false)
    expect(isCustomizableCommand('go-to-heading:12')).toBe(false)
    // The plain pane opener stays customisable.
    expect(isCustomizableCommand('go-to-heading')).toBe(true)
    const dyn = { id: 'go-to-heading:0', title: () => 'Heading' }
    expect(applyCustomShortcuts([dyn], { 'go-to-heading:0': ctrlX })[0]).toBe(dyn)
    expect(assignCustomShortcut({}, 'go-to-heading:0', ctrlX).map).toEqual({})
  })
})
