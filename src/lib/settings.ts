// M2-08 Personalization (§20). ONE settings store, separate from document
// content: localStorage key 'vyro-web-settings-v1'. Nothing here touches
// the docs store, premium/entitlement logic, or Supabase code.
//
// Safety contract: loadSettings() NEVER throws and NEVER returns an invalid
// value — corrupt JSON, wrong types, unknown enum strings and out-of-range
// numbers each fall back to that field's default while valid fields are
// preserved. Legacy keys ('vyro-web-theme', 'vyro-web-ui-lang') seed the
// defaults only when no settings record exists yet, so existing users keep
// their theme/language instead of being reset.
import { loadUiLang, type UiLang } from './i18n'

export const SETTINGS_KEY = 'vyro-web-settings-v1'
const LEGACY_THEME_KEY = 'vyro-web-theme'

export type UiSize = 'compact' | 'comfortable' | 'large'
export type ThemePreference = 'light' | 'dark' | 'system'
export type ToolbarMode = 'full' | 'compact'
export type WritingWidth = 'narrow' | 'normal' | 'wide'
export type DefaultDir = 'ltr' | 'rtl'

export interface VyroSettings {
  uiLang: UiLang
  uiSize: UiSize
  writingWidth: WritingWidth
  toolbar: ToolbarMode
  theme: ThemePreference
  defaultDir: DefaultDir
  defaultFont: string
  defaultFontSize: number
  autosaveEnabled: boolean
  autosaveIntervalMs: number
  /** Tier-1 S3: browser spellcheck on/off for the editor. Persisted like
   *  every other setting; defaults ON (the pre-S3 behaviour). This only
   *  toggles the browser's own checker — Vyro ships no dictionary/engine. */
  spellcheck: boolean
}

/** Fonts the editor already offers (Editor.tsx font select). Kept here so
 *  the settings panel and the editor can never drift apart. */
export const EDITOR_FONTS: string[] = ['Vazirmatn', 'Tahoma', 'Arial', 'Georgia', "'Times New Roman'", "'Courier New'"]
export const EDITOR_FONT_SIZES: number[] = [11, 12, 14, 16, 18, 20, 24, 28, 36]
export const AUTOSAVE_INTERVALS = [250, 500, 1000, 2000, 5000] as const
export const MIN_AUTOSAVE_MS = 250
export const MAX_AUTOSAVE_MS = 10000

export const DEFAULT_SETTINGS: VyroSettings = {
  uiLang: 'en',
  uiSize: 'comfortable',
  writingWidth: 'normal',
  toolbar: 'full',
  theme: 'light',
  defaultDir: 'ltr',
  defaultFont: 'Vazirmatn',
  defaultFontSize: 16,
  autosaveEnabled: true,
  autosaveIntervalMs: 500,
  spellcheck: true,
}

/** Fresh copy of the defaults (callers mutate the result freely). */
export function defaultSettings(): VyroSettings {
  return { ...DEFAULT_SETTINGS }
}

function isUiSize(v: unknown): v is UiSize {
  return v === 'compact' || v === 'comfortable' || v === 'large'
}
function isThemePref(v: unknown): v is ThemePreference {
  return v === 'light' || v === 'dark' || v === 'system'
}
function isToolbarMode(v: unknown): v is ToolbarMode {
  return v === 'full' || v === 'compact'
}
function isWritingWidth(v: unknown): v is WritingWidth {
  return v === 'narrow' || v === 'normal' || v === 'wide'
}
function isDefaultDir(v: unknown): v is DefaultDir {
  return v === 'ltr' || v === 'rtl'
}

/**
 * Validate + repair a stored settings object field by field. Unknown extra
 * keys are dropped; a non-object (or a value of the wrong type) yields the
 * defaults. `legacy` supplies theme/language only when the record itself
 * does not carry them — it is how first-run migration works.
 */
export function sanitizeSettings(raw: unknown, legacy?: { theme?: string | null; uiLang?: UiLang }): VyroSettings {
  const out = defaultSettings()
  if (legacy?.theme === 'dark' || legacy?.theme === 'light') out.theme = legacy.theme
  if (legacy?.uiLang) out.uiLang = legacy.uiLang
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  const r = raw as Record<string, unknown>
  if (r.uiLang === 'en' || r.uiLang === 'fa') out.uiLang = r.uiLang
  if (isUiSize(r.uiSize)) out.uiSize = r.uiSize
  if (isWritingWidth(r.writingWidth)) out.writingWidth = r.writingWidth
  if (isToolbarMode(r.toolbar)) out.toolbar = r.toolbar
  if (isThemePref(r.theme)) out.theme = r.theme
  if (isDefaultDir(r.defaultDir)) out.defaultDir = r.defaultDir
  if (typeof r.defaultFont === 'string' && (EDITOR_FONTS as readonly string[]).includes(r.defaultFont)) out.defaultFont = r.defaultFont
  if (typeof r.defaultFontSize === 'number' && Number.isFinite(r.defaultFontSize) && (EDITOR_FONT_SIZES as readonly number[]).includes(r.defaultFontSize)) out.defaultFontSize = r.defaultFontSize
  if (typeof r.autosaveEnabled === 'boolean') out.autosaveEnabled = r.autosaveEnabled
  if (typeof r.spellcheck === 'boolean') out.spellcheck = r.spellcheck
  if (typeof r.autosaveIntervalMs === 'number' && Number.isFinite(r.autosaveIntervalMs)) {
    out.autosaveIntervalMs = Math.min(MAX_AUTOSAVE_MS, Math.max(MIN_AUTOSAVE_MS, Math.round(r.autosaveIntervalMs)))
  }
  return out
}

type StorageLike = Pick<Storage, 'getItem'> & Partial<Pick<Storage, 'setItem'>>

function readLegacy(storage: StorageLike): { theme?: string | null; uiLang?: UiLang } {
  let theme: string | null = null
  try { theme = storage.getItem(LEGACY_THEME_KEY) } catch { /* best-effort */ }
  let uiLang: UiLang = 'en'
  try { uiLang = loadUiLang(storage) } catch { /* best-effort */ }
  return { theme, uiLang }
}

/** Load settings, migrating legacy theme/language when no record exists. Never throws. */
export function loadSettings(storage: StorageLike): VyroSettings {
  let raw: string | null = null
  try { raw = storage.getItem(SETTINGS_KEY) } catch { return defaultSettings() }
  if (!raw) return sanitizeSettings(null, readLegacy(storage))
  try {
    return sanitizeSettings(JSON.parse(raw))
  } catch {
    // Corrupt JSON: fall back to defaults (+ legacy seed), never crash.
    return sanitizeSettings(null, readLegacy(storage))
  }
}

/** Persist settings. Returns false when storage rejects the write. Never throws. */
export function saveSettings(storage: Pick<Storage, 'setItem'>, settings: VyroSettings): boolean {
  try { storage.setItem(SETTINGS_KEY, JSON.stringify(settings)); return true } catch { return false }
}

/** Resolve an effective light/dark theme. `system` follows the OS preference
 *  (the boolean a matchMedia('(prefers-color-scheme: dark)') listener reports);
 *  an explicit choice always wins over the OS value. Pure, unit-testable. */
export function resolveTheme(pref: ThemePreference, systemDark: boolean): 'light' | 'dark' {
  if (pref === 'system') return systemDark ? 'dark' : 'light'
  return pref
}

/**
 * Effective debounce delay for the editor's autosave, or null when autosave
 * is off. When off, edits are NOT background-saved: they flush only on
 * "Save now" or on leaving the document (the editor's existing flush), and
 * the beforeunload guard still warns while a save is pending — the setting
 * is never presented as a timer that does nothing, nor as a silent save.
 */
export function resolveAutosaveDelay(settings: VyroSettings): number | null {
  if (!settings.autosaveEnabled) return null
  return Math.min(MAX_AUTOSAVE_MS, Math.max(MIN_AUTOSAVE_MS, Math.round(settings.autosaveIntervalMs)))
}

/** CSS class for the app chrome's UI-size setting ('' = comfortable default). */
export function uiSizeClass(size: UiSize): string {
  return size === 'comfortable' ? '' : `ui-size-${size}`
}

/** Direction for a document created from a template: a template keeps its
 *  own direction (Dari templates are RTL by design); a blank document takes
 *  the user's default direction. */
export function newDocDir(templateDir: DefaultDir, isBlank: boolean, defaultDir: DefaultDir): DefaultDir {
  return isBlank ? defaultDir : templateDir
}

type JsonNode = { type?: string; content?: JsonNode[]; marks?: { type: string; attrs?: Record<string, unknown> }[]; [k: string]: unknown }

function applyToNode(node: JsonNode, font: string, size: number): JsonNode {
  const out: JsonNode = { ...node }
  if (node.type === 'text') {
    const marks = [...(node.marks ?? [])]
    const idx = marks.findIndex((m) => m.type === 'textStyle')
    const existing = idx >= 0 ? { ...(marks[idx].attrs ?? {}) } : {}
    if (existing.fontFamily == null) existing.fontFamily = font
    if (existing.fontSize == null) existing.fontSize = `${size}px`
    const styleMark = { type: 'textStyle', attrs: existing }
    if (idx >= 0) marks[idx] = styleMark
    else marks.push(styleMark)
    out.marks = marks
  }
  if (Array.isArray(node.content)) out.content = node.content.map((c) => applyToNode(c, font, size))
  return out
}

/**
 * Apply new-document font/size defaults to template content: every text
 * node gains a textStyle mark with the default font/size, but ONLY where
 * that attribute is not already set — existing template formatting is
 * never overwritten. The input is never mutated (deep copy via recursion).
 * Blank content has no text nodes, so it comes back unchanged; for blank
 * docs the editor applies the same defaults as stored marks on the first
 * keystroke (see Editor's freshDefaults prop).
 */
export function applyNewDocDefaults(content: unknown, settings: VyroSettings): unknown {
  if (!content || typeof content !== 'object') return content
  const doc = content as JsonNode
  if (!Array.isArray(doc.content)) return content
  return { ...doc, content: doc.content.map((c) => applyToNode(c, settings.defaultFont, settings.defaultFontSize)) }
}
