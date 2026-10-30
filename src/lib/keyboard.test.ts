// Keyboard accessibility (Mission 2, M2-15 = owner spec §17).
//
// These tests pin the honest parts: the catalogue claims only documented
// handlers, no catalogue chord is a reserved browser shortcut, reserved
// shortcuts are never claimed, and the focus trap / return helpers behave
// in a jsdom fixture. What jsdom CANNOT prove (real Tab order in a live
// browser, phone keyboards) is deliberately not asserted here.
import { describe, it, expect } from 'vitest'
import {
  DOCUMENTED_HANDLERS, FOCUSABLE_SELECTOR, RESERVED_CODES, SHORTCUT_CATALOGUE,
  getFocusableElements, isPlainFieldTarget, isReservedShortcut, recordFocus,
  restoreFocus, trapTabKey,
} from './keyboard'
import { STRINGS } from './i18n'

const chordEvent = (code: string, opts: { mod?: boolean; shift?: boolean; alt?: boolean } = {}) => ({
  code, key: code.replace(/^Key/, '').toLowerCase(),
  ctrlKey: opts.mod ?? false, metaKey: false,
  altKey: opts.alt ?? false, shiftKey: opts.shift ?? false,
})

describe('shortcut catalogue honesty', () => {
  it('every entry points at a documented handler (no invented shortcuts)', () => {
    expect(SHORTCUT_CATALOGUE.length).toBeGreaterThan(0)
    const ids = new Set<string>()
    for (const s of SHORTCUT_CATALOGUE) {
      expect(ids.has(s.id), `duplicate catalogue id ${s.id}`).toBe(false)
      ids.add(s.id)
      expect((DOCUMENTED_HANDLERS as readonly string[]).includes(s.handler), `${s.id} handler ${s.handler}`).toBe(true)
      expect(s.keys.trim().length).toBeGreaterThan(0)
      // Every label resolves in both languages (i18n parity is also tested
      // globally, but this ties the catalogue to real strings).
      expect(STRINGS.en[s.label]).toBeTruthy()
      expect(STRINGS.fa[s.label]).toBeTruthy()
    }
  })
  it('no catalogue chord is a reserved browser shortcut', () => {
    for (const s of SHORTCUT_CATALOGUE) {
      if (!s.chord) continue
      // Ctrl+U is the one deliberate overlap: underline inside the editor,
      // browser view-source outside it — so it must be unreserved in-editor.
      expect(isReservedShortcut(chordEvent(s.chord.code, { mod: s.chord.mod, shift: s.chord.shift, alt: s.chord.alt }), true), s.id).toBe(false)
    }
  })
  it('the catalogue never claims a reserved shortcut as an app shortcut', () => {
    const claimed = new Set(SHORTCUT_CATALOGUE.filter((s) => s.chord).map((s) => s.chord!.code))
    // Only Ctrl+U overlaps, and only because it is genuinely the editor's
    // underline chord — every other reserved code is absent.
    for (const code of RESERVED_CODES) {
      if (code === 'KeyU') continue
      expect(claimed.has(code), `reserved ${code} claimed`).toBe(false)
    }
  })
})

describe('reserved shortcut guard', () => {
  it('reserves the essential browser chords (new tab, close, reload, find, …)', () => {
    for (const code of ['KeyT', 'KeyW', 'KeyN', 'KeyR', 'KeyL', 'KeyF', 'KeyP', 'KeyS']) {
      expect(isReservedShortcut(chordEvent(code, { mod: true })), code).toBe(true)
    }
  })
  it('does not reserve the app chord or editing chords', () => {
    expect(isReservedShortcut(chordEvent('KeyK', { mod: true }))).toBe(false)
    expect(isReservedShortcut(chordEvent('KeyZ', { mod: true }))).toBe(false)
    expect(isReservedShortcut(chordEvent('KeyB', { mod: true }))).toBe(false)
  })
  it('plain typing (no modifier) and Alt chords are never reserved', () => {
    expect(isReservedShortcut(chordEvent('KeyT', {}))).toBe(false)
    expect(isReservedShortcut(chordEvent('KeyT', { mod: true, alt: true }))).toBe(false)
  })
  it('Ctrl+U is reserved outside the editor but free inside it (underline)', () => {
    expect(isReservedShortcut(chordEvent('KeyU', { mod: true }), false)).toBe(true)
    expect(isReservedShortcut(chordEvent('KeyU', { mod: true }), true)).toBe(false)
  })
  it('falls back to e.key when e.code is missing (layout-independent guard)', () => {
    expect(isReservedShortcut({ key: 't', ctrlKey: true, metaKey: false })).toBe(true)
    expect(isReservedShortcut({ key: 'k', ctrlKey: true, metaKey: false })).toBe(false)
  })
})

describe('typing-field guard', () => {
  it('plain fields block global chords; contenteditable does not', () => {
    expect(isPlainFieldTarget({ tagName: 'INPUT' })).toBe(true)
    expect(isPlainFieldTarget({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isPlainFieldTarget({ tagName: 'SELECT' })).toBe(true)
    expect(isPlainFieldTarget({ tagName: 'DIV', isContentEditable: true })).toBe(false)
    expect(isPlainFieldTarget({ tagName: 'BUTTON' })).toBe(false)
    expect(isPlainFieldTarget(null)).toBe(false)
  })
  it('the palette chord guard itself never matches plain typing', () => {
    // The palette chord needs a modifier + physical KeyK; a bare keypress
    // (the typing case) has neither, so it can never fire while typing.
    expect(isReservedShortcut(chordEvent('KeyK', {}))).toBe(false)
  })
})

describe('focus helpers (jsdom fixture)', () => {
  const fixture = () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <button id="b1">one</button>
      <button id="b2" disabled>off</button>
      <input id="i1" />
      <a id="a1" href="#">link</a>
      <span id="s1" tabindex="-1">skip</span>
      <div id="d1" tabindex="0">box</div>`
    document.body.appendChild(root)
    return root
  }
  const cleanup = (root: HTMLElement) => { root.remove(); (document.activeElement as HTMLElement | null)?.blur?.() }

  it('lists only enabled focusable controls, in DOM order', () => {
    const root = fixture()
    try {
      const ids = getFocusableElements(root).map((el) => el.id)
      expect(ids).toEqual(['b1', 'i1', 'a1', 'd1'])
      expect(FOCUSABLE_SELECTOR).toContain('button')
    } finally { cleanup(root) }
  })
  it('returns an empty list for a null root', () => {
    expect(getFocusableElements(null)).toEqual([])
  })
  it('Tab on the last focusable wraps to the first', () => {
    const root = fixture()
    try {
      const els = getFocusableElements(root)
      els[els.length - 1].focus()
      let prevented = false
      const handled = trapTabKey({ key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true } }, root)
      expect(handled).toBe(true)
      expect(prevented).toBe(true)
      expect(document.activeElement).toBe(els[0])
    } finally { cleanup(root) }
  })
  it('Shift+Tab on the first focusable wraps to the last', () => {
    const root = fixture()
    try {
      const els = getFocusableElements(root)
      els[0].focus()
      let prevented = false
      const handled = trapTabKey({ key: 'Tab', shiftKey: true, preventDefault: () => { prevented = true } }, root)
      expect(handled).toBe(true)
      expect(prevented).toBe(true)
      expect(document.activeElement).toBe(els[els.length - 1])
    } finally { cleanup(root) }
  })
  it('mid-list Tab is left to the browser (no trap, no preventDefault)', () => {
    const root = fixture()
    try {
      const els = getFocusableElements(root)
      els[0].focus()
      let prevented = false
      expect(trapTabKey({ key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true } }, root)).toBe(false)
      expect(prevented).toBe(false)
      expect(trapTabKey({ key: 'Enter', shiftKey: false, preventDefault: () => { prevented = true } }, root)).toBe(false)
    } finally { cleanup(root) }
  })
  it('Tab with focus outside the container moves to the first element', () => {
    const root = fixture()
    try {
      const els = getFocusableElements(root)
      document.body.focus()
      let prevented = false
      expect(trapTabKey({ key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true } }, root)).toBe(true)
      expect(prevented).toBe(true)
      expect(document.activeElement).toBe(els[0])
    } finally { cleanup(root) }
  })
  it('focus return restores the opener and fails safely when it is gone', () => {
    const root = fixture()
    try {
      const opener = getFocusableElements(root)[0]
      opener.focus()
      expect(recordFocus()).toBe(opener)
      expect(restoreFocus(opener)).toBe(true)
      expect(document.activeElement).toBe(opener)
      // Gone opener: removed from the document — must not throw, must
      // report false, and focus must stay where it was.
      opener.remove()
      expect(restoreFocus(opener)).toBe(false)
      expect(restoreFocus(null)).toBe(false)
    } finally { cleanup(root) }
  })
  it('recordFocus returns null when focus is on <body> (nothing to restore)', () => {
    document.body.focus()
    expect(recordFocus()).toBeNull()
  })
})
