// Keyboard accessibility (Mission 2, M2-15 = owner spec §17).
//
// This module is the single source of truth for keyboard behaviour:
//  - SHORTCUT_CATALOGUE lists ONLY shortcuts that genuinely work in the
//    app (audited against the real handlers — see the `handler` field).
//    Nothing is invented: TipTap editing shortcuts come from StarterKit /
//    the Underline extension / TableKit, the palette chord from App, and
//    Esc/arrows/Tab handling from the dialog + panel components.
//  - RESERVED_* lists the essential browser shortcuts the app must never
//    hijack. No custom keydown handler in the app may preventDefault one
//    of these, and the catalogue never claims one.
//  - Focus helpers are pure DOM utilities (no React), so they are unit-
//    testable in jsdom. Real Tab order in a live browser and touch /
//    phone keyboards are NOT verifiable here — see the M2-15 report gaps.

import type { I18nKey } from './i18n'

/** A keyboard chord, described by physical code so it works under a
 *  Persian/Farsi layout (same model as the palette chord guard). */
export interface KeyChord {
  code: string
  /** Ctrl on Windows/Linux, Cmd on macOS. */
  mod?: boolean
  shift?: boolean
  alt?: boolean
}

export type ShortcutGroup = 'app' | 'editing' | 'dialogs'

export interface ShortcutEntry {
  id: string
  /** Display form, e.g. 'Ctrl+K / ⌘K'. Never a claim beyond the handler. */
  keys: string
  group: ShortcutGroup
  label: I18nKey
  /** Where the shortcut is actually implemented (audited, not aspirational). */
  handler: string
  /** Present only for real key chords (Esc/Tab/arrows have no chord). */
  chord?: KeyChord
}

/** Every handler id the catalogue may reference. The catalogue test pins
 *  entries to this list, so a future entry cannot silently point at
 *  nothing. Meanings:
 *  - app:palette — App.tsx global Ctrl/Cmd+K handler (commands.ts guard).
 *  - app:escape — Esc closes dialogs/menus/panels/view-modes (each owner).
 *  - app:tab — native Tab order + useDialogFocus trap inside dialogs.
 *  - app:activate — native Enter/Space on <button> controls.
 *  - tiptap:* — TipTap StarterKit / Underline / TableKit default keymaps.
 *  - app:menu-arrows / app:menu-enter — CommandPalette + ContextMenu. */
export const DOCUMENTED_HANDLERS = [
  'app:palette',
  'app:escape',
  'app:tab',
  'app:activate',
  'tiptap:undo',
  'tiptap:redo',
  'tiptap:bold',
  'tiptap:italic',
  'tiptap:underline',
  'tiptap:strike',
  'tiptap:table-tab',
  'app:menu-arrows',
  'app:menu-enter',
] as const

export const SHORTCUT_CATALOGUE: ShortcutEntry[] = [
  { id: 'palette', keys: 'Ctrl+K / ⌘K', group: 'app', label: 'shortcutPalette', handler: 'app:palette', chord: { code: 'KeyK', mod: true } },
  { id: 'escape-close', keys: 'Esc', group: 'dialogs', label: 'shortcutEscapeClose', handler: 'app:escape' },
  { id: 'tab-focus', keys: 'Tab / Shift+Tab', group: 'app', label: 'shortcutTabFocus', handler: 'app:tab' },
  { id: 'activate', keys: 'Enter / Space', group: 'app', label: 'shortcutActivate', handler: 'app:activate' },
  { id: 'undo', keys: 'Ctrl+Z / ⌘Z', group: 'editing', label: 'shortcutUndo', handler: 'tiptap:undo', chord: { code: 'KeyZ', mod: true } },
  { id: 'redo', keys: 'Ctrl+Shift+Z / Ctrl+Y', group: 'editing', label: 'shortcutRedo', handler: 'tiptap:redo', chord: { code: 'KeyZ', mod: true, shift: true } },
  { id: 'bold', keys: 'Ctrl+B / ⌘B', group: 'editing', label: 'shortcutBold', handler: 'tiptap:bold', chord: { code: 'KeyB', mod: true } },
  { id: 'italic', keys: 'Ctrl+I / ⌘I', group: 'editing', label: 'shortcutItalic', handler: 'tiptap:italic', chord: { code: 'KeyI', mod: true } },
  { id: 'underline', keys: 'Ctrl+U / ⌘U', group: 'editing', label: 'shortcutUnderline', handler: 'tiptap:underline', chord: { code: 'KeyU', mod: true } },
  { id: 'strike', keys: 'Ctrl+Shift+X', group: 'editing', label: 'shortcutStrike', handler: 'tiptap:strike', chord: { code: 'KeyX', mod: true, shift: true } },
  { id: 'table-tab', keys: 'Tab (in tables)', group: 'editing', label: 'shortcutTableTab', handler: 'tiptap:table-tab' },
  { id: 'menu-arrows', keys: '↑ / ↓', group: 'dialogs', label: 'shortcutMenuArrows', handler: 'app:menu-arrows' },
  { id: 'menu-enter', keys: 'Enter', group: 'dialogs', label: 'shortcutMenuEnter', handler: 'app:menu-enter' },
]

export const SHORTCUT_GROUP_ORDER: ShortcutGroup[] = ['app', 'editing', 'dialogs']

export const SHORTCUT_GROUP_LABEL: Record<ShortcutGroup, I18nKey> = {
  app: 'shortcutGroupApp',
  editing: 'shortcutGroupEditing',
  dialogs: 'shortcutGroupDialogs',
}

/** Essential browser shortcuts (Ctrl/Cmd + key). The app binds NONE of
 *  these: Ctrl+F deliberately stays the browser's find (see
 *  FindReplacePanel's header comment), and no handler preventDefaults
 *  them. Deliberately NOT here: Ctrl+K (the app's palette), Ctrl+Z/Y/B/
 *  I/U/X (editing shortcuts that genuinely work in the editor). */
export const RESERVED_CODES = [
  'KeyT', // new tab
  'KeyW', // close tab
  'KeyN', // new window
  'KeyR', // reload
  'KeyL', // focus address bar
  'KeyF', // browser find
  'KeyP', // browser print
  'KeyS', // browser save
  'KeyH', // browser history
  'KeyD', // bookmark
  'KeyJ', // downloads
  'KeyU', // view source — note: NOT Ctrl+U in the editor. See below.
  'KeyG', // find next
] as const

/**
 * True when the event is a reserved browser shortcut. Ctrl+U is special:
 * inside the editable document it is TipTap's underline (a real app
 * shortcut), but in a plain field / outside the editor it belongs to the
 * browser — so callers pass `inEditor` and this guard only reserves Ctrl+U
 * when NOT editing. Every other reserved code is reserved everywhere.
 */
export function isReservedShortcut(
  e: { code?: string; key?: string; ctrlKey: boolean; metaKey: boolean; altKey?: boolean },
  inEditor = false,
): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return false
  const code = e.code ?? (e.key && /^[a-zA-Z]$/.test(e.key) ? `Key${e.key.toUpperCase()}` : undefined)
  if (!code) return false
  if (code === 'KeyU' && inEditor) return false
  return (RESERVED_CODES as readonly string[]).includes(code)
}

/** True for plain text fields (input/textarea/select) — but NOT for a
 *  contenteditable editor surface, where app chords legitimately apply.
 *  Global handlers use this to avoid firing while the user types in a
 *  field (the palette chord guard is the model: it never matches plain
 *  typing, and now it also never opens from inside a plain field). */
export function isPlainFieldTarget(target: { tagName?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!target || target.isContentEditable) return false
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
}

// ---- Focus helpers (pure DOM; jsdom-testable) ----

/** Selector for natively focusable, enabled controls. Visibility is the
 *  browser's job at runtime (a hidden element's focus() is a no-op); this
 *  list intentionally does not filter on layout, which jsdom cannot do. */
export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function getFocusableElements(root: Element | null | undefined): HTMLElement[] {
  if (!root) return []
  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (el): el is HTMLElement => el instanceof HTMLElement,
  )
}

/**
 * Trap Tab / Shift+Tab inside `root`: Tab on the last focusable wraps to
 * the first, Shift+Tab on the first wraps to the last. Returns true when
 * it handled the event. Non-Tab keys and empty containers are untouched.
 * The active element is read from the container's own document, so the
 * helper works in jsdom fixtures as well as in the live page.
 */
export function trapTabKey(
  e: { key: string; shiftKey: boolean; preventDefault: () => void },
  root: Element | null | undefined,
): boolean {
  if (e.key !== 'Tab') return false
  const els = getFocusableElements(root)
  if (!els.length) return false
  const doc = root?.ownerDocument ?? (typeof document !== 'undefined' ? document : undefined)
  const active = doc?.activeElement ?? null
  const idx = els.indexOf(active as HTMLElement)
  if (!e.shiftKey) {
    if (idx === -1 || idx === els.length - 1) {
      e.preventDefault()
      els[0].focus()
      return true
    }
    return false
  }
  if (idx <= 0) {
    e.preventDefault()
    els[els.length - 1].focus()
    return true
  }
  return false
}

/** The element to return focus to when a dialog/panel closes: the focused
 *  element at open time, or null when focus was on <body> / nowhere (in
 *  which case there is nothing meaningful to restore). */
export function recordFocus(doc?: Document): Element | null {
  const d = doc ?? (typeof document !== 'undefined' ? document : undefined)
  const active = d?.activeElement ?? null
  if (!active || active === d?.body) return null
  return active
}

/**
 * Restore focus to a previously recorded element. Returns false — and
 * touches nothing — when the element is gone (unmounted) or not an
 * HTMLElement, so a closed dialog can never throw or steal focus to a
 * dead node. That false IS the safe fallback the callers rely on.
 */
export function restoreFocus(el: Element | null | undefined, doc?: Document): boolean {
  const d = doc ?? (typeof document !== 'undefined' ? document : undefined)
  if (!el || !(el instanceof HTMLElement)) return false
  if (d && !d.contains(el)) return false
  el.focus()
  return true
}
