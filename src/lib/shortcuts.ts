// Configurable palette shortcuts (Mission 2, P2-14 = owner spec §2 remainder).
//
// SCOPE, stated honestly: this customises ONLY command-palette commands.
// TipTap editor chords (Ctrl+B bold, Ctrl+Z undo, …) are NOT rebindable
// here: they live in TipTap's StarterKit/Underline/TableKit keymaps, not in
// a palette registry the app owns, so rebinding them would mean forking
// those keymaps. That remainder is recorded, not silently claimed.
//
// Model: code-based chords (same KeyChord shape as keyboard.ts) so a
// binding works under a Persian/Farsi layout, where e.key is not Latin.
// Storage is localStorage only; no network, no prompt/confirm/alert.

import { isReservedShortcut, SHORTCUT_CATALOGUE, type KeyChord } from './keyboard'

export type { KeyChord }

export const CUSTOM_SHORTCUTS_KEY = 'vyro-web-shortcuts-v1'

/** commandId → chord. Only stable palette command ids belong here. */
export type CustomShortcutMap = Record<string, KeyChord>

/** Why a chord was rejected (null = accepted). */
export type ChordError = 'no-mod' | 'reserved' | 'builtin' | 'duplicate' | 'palette'

/**
 * Dynamic per-heading ids are unstable (the index shifts as the document
 * changes), so they are never customisable. The plain 'go-to-heading'
 * pane opener does NOT start with 'go-to-heading:' and stays customisable.
 */
export function isCustomizableCommand(id: string): boolean {
  return !id.startsWith('go-to-heading:')
}

function isValidChord(value: unknown): value is KeyChord {
  if (!value || typeof value !== 'object') return false
  const c = value as Record<string, unknown>
  if (typeof c.code !== 'string' || !c.code) return false
  for (const k of ['mod', 'shift', 'alt'] as const) {
    if (c[k] !== undefined && typeof c[k] !== 'boolean') return false
  }
  return true
}

function normalizeChord(c: KeyChord): KeyChord {
  return { code: c.code, mod: !!c.mod, shift: !!c.shift, alt: !!c.alt }
}

/** Tolerant load: corrupt JSON, wrong shapes, or blocked storage → {}. Never throws. */
export function loadCustomShortcuts(storage: Pick<Storage, 'getItem'>): CustomShortcutMap {
  try {
    const raw = storage.getItem(CUSTOM_SHORTCUTS_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const map: CustomShortcutMap = {}
    for (const [id, chord] of Object.entries(parsed as Record<string, unknown>)) {
      if (isValidChord(chord)) map[id] = normalizeChord(chord)
    }
    return map
  } catch {
    return {}
  }
}

/** Best-effort save: blocked storage never throws. */
export function saveCustomShortcuts(storage: Pick<Storage, 'setItem'>, map: CustomShortcutMap): void {
  try {
    storage.setItem(CUSTOM_SHORTCUTS_KEY, JSON.stringify(map))
  } catch {
    /* best-effort */
  }
}

/** Display label, e.g. Ctrl+Shift+X. 'Ctrl' stands for Ctrl/Cmd (mod). */
export function formatChord(chord: KeyChord): string {
  const parts: string[] = []
  if (chord.mod) parts.push('Ctrl')
  if (chord.alt) parts.push('Alt')
  if (chord.shift) parts.push('Shift')
  let key = chord.code
  if (key.startsWith('Key')) key = key.slice(3)
  else if (key.startsWith('Digit')) key = key.slice(5)
  // Space / Enter / ArrowUp / … keep their full code names.
  parts.push(key)
  return parts.join('+')
}

/** Build a chord from a DOM keyboard event (code-based, layout-proof). */
export function chordFromEvent(e: {
  code: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey?: boolean
  altKey?: boolean
}): KeyChord {
  return { code: e.code, mod: e.ctrlKey || e.metaKey, shift: !!e.shiftKey, alt: !!e.altKey }
}

export function chordsEqual(a: KeyChord, b: KeyChord): boolean {
  return a.code === b.code && !!a.mod === !!b.mod && !!a.shift === !!b.shift && !!a.alt === !!b.alt
}

/** True when the event is a bare modifier key (no chord to capture yet). */
export function isModifierCode(code: string): boolean {
  return (
    code === 'ControlLeft' || code === 'ControlRight' ||
    code === 'MetaLeft' || code === 'MetaRight' ||
    code === 'ShiftLeft' || code === 'ShiftRight' ||
    code === 'AltLeft' || code === 'AltRight'
  )
}

/**
 * Validate a candidate chord for `commandId` against the existing map.
 * Order matters: the palette chord (Ctrl+K) is also in the catalogue, so
 * it must be reported as 'palette', not 'builtin'.
 * - 'no-mod': missing Ctrl/Cmd — this also covers Alt-modified chords,
 *   which are never valid custom chords (Alt belongs to the browser/OS).
 * - 'reserved': a RESERVED_CODES browser chord in either context (a chord
 *   reserved outside the editor is rejected even if the editor frees it:
 *   custom palette shortcuts fire app-wide, not editor-only).
 * - 'builtin': any chord already claimed by SHORTCUT_CATALOGUE.
 * - 'duplicate': already assigned to a different command.
 */
export function validateChord(
  chord: KeyChord,
  map: CustomShortcutMap,
  commandId: string,
): ChordError | null {
  if (!chord.mod || chord.alt) return 'no-mod'
  // The palette chord is code KeyK + mod (isPaletteShortcut ignores shift,
  // so Ctrl+Shift+K opens the palette too) — reject any KeyK chord here.
  if (chord.code === 'KeyK') return 'palette'
  const eventLike = { code: chord.code, ctrlKey: !!chord.mod, metaKey: false, shiftKey: !!chord.shift, altKey: false }
  if (isReservedShortcut(eventLike, false) || isReservedShortcut(eventLike, true)) return 'reserved'
  if (SHORTCUT_CATALOGUE.some((e) => e.chord && chordsEqual(e.chord, chord))) return 'builtin'
  for (const [id, existing] of Object.entries(map)) {
    if (id !== commandId && chordsEqual(existing, chord)) return 'duplicate'
  }
  return null
}

/** Assign (or reject) a chord: returns the error, or the new map on success. */
export function assignCustomShortcut(
  map: CustomShortcutMap,
  commandId: string,
  chord: KeyChord,
): { map: CustomShortcutMap; error: ChordError | null } {
  if (!isCustomizableCommand(commandId)) return { map, error: 'builtin' }
  const error = validateChord(chord, map, commandId)
  if (error) return { map, error }
  return { map: { ...map, [commandId]: normalizeChord(chord) }, error: null }
}

/** Remove one command's custom chord. */
export function clearCustomShortcut(map: CustomShortcutMap, commandId: string): CustomShortcutMap {
  const next = { ...map }
  delete next[commandId]
  return next
}

/** Match a keydown event against the map (code-based). Returns the command id or null. */
export function matchCustomShortcut(
  map: CustomShortcutMap,
  e: { code: string; ctrlKey: boolean; metaKey: boolean; shiftKey?: boolean; altKey?: boolean },
): string | null {
  const chord = chordFromEvent(e)
  for (const [id, stored] of Object.entries(map)) {
    if (chordsEqual(stored, chord)) return id
  }
  return null
}

/**
 * Overlay custom chords onto a command list as display labels. Commands
 * without a custom chord — and dynamic go-to-heading ids — are returned
 * unchanged (same object, not a copy).
 */
export function applyCustomShortcuts<T extends { id: string; shortcut?: string }>(
  commands: T[],
  map: CustomShortcutMap,
): T[] {
  return commands.map((cmd) => {
    const chord = map[cmd.id]
    if (!chord || !isCustomizableCommand(cmd.id)) return cmd
    return { ...cmd, shortcut: formatChord(chord) }
  })
}
