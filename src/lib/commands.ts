// Command palette registry (Mission 2, item M2-1).
//
// A command is only registered when its action genuinely exists: editor-only
// actions (insert table/date, zoom, export) are passed in by the editor and
// omitted entirely when no document is open. Nothing here stubs an action.
//
// Search is case-insensitive and tolerant of Persian/Arabic spelling drift
// (ك/ي vs ک/ی, ZWNJ/ZWJ, diacritics): a query matches when its normalised
// form is a substring of the normalised title, or its characters appear in
// order inside the title (subsequence fuzzy match).
import { tr, type UiLang, type I18nKey } from './i18n'
import { templateName, type Template } from './templates'

export const RECENT_COMMANDS_KEY = 'vyro-web-recent-commands'
export const MAX_RECENT_COMMANDS = 5

export interface PaletteCommand {
  id: string
  /** Localised title, resolved at render time so a language switch re-labels. */
  title: (lang: UiLang) => string
  shortcut?: string
  run: () => void
}

/** Actions the palette may offer. Editor actions are optional: absent = omitted. */
export interface CommandActions {
  createBlank: () => void
  createFromTemplate: (id: string) => void
  goDashboard: () => void
  toggleTheme: () => void
  toggleLanguage: () => void
  theme: string
  lang: UiLang
  templates: Template[]
  insertTable?: () => void
  insertDate?: () => void
  exportTxt?: () => void
  exportHtml?: () => void
  zoomIn?: () => void
  zoomOut?: () => void
  zoomReset?: () => void
  pastePlainText?: () => void
  openNavigation?: () => void
}

const titleKey = (key: I18nKey): ((lang: UiLang) => string) => (lang) => tr(lang, key)

/** Build the full registry for the current context. Never returns a no-op. */
export function buildCommands(a: CommandActions): PaletteCommand[] {
  const cmds: PaletteCommand[] = [
    { id: 'new-document', title: titleKey('newDocument'), run: a.createBlank },
    ...a.templates.map((tpl): PaletteCommand => ({
      id: `template:${tpl.id}`,
      title: (lang) => templateName(tpl, lang),
      run: () => a.createFromTemplate(tpl.id),
    })),
    { id: 'go-dashboard', title: titleKey('dashboard'), run: a.goDashboard },
    {
      id: 'toggle-theme',
      title: (lang) => tr(lang, a.theme === 'dark' ? 'lightUi' : 'darkUi'),
      run: a.toggleTheme,
    },
    {
      id: 'toggle-language',
      title: (lang) => tr(lang, lang === 'en' ? 'switchToPersian' : 'switchToEnglish'),
      run: a.toggleLanguage,
    },
  ]
  // Editor-only commands: registered only when the editor really provides them.
  if (a.insertTable) cmds.push({ id: 'insert-table', title: titleKey('insertTable'), run: a.insertTable })
  if (a.insertDate) cmds.push({ id: 'insert-date', title: titleKey('insertDate'), run: a.insertDate })
  if (a.exportTxt) cmds.push({ id: 'export-txt', title: titleKey('exportTxt'), run: a.exportTxt })
  if (a.exportHtml) cmds.push({ id: 'export-html', title: titleKey('exportHtml'), run: a.exportHtml })
  if (a.zoomIn) cmds.push({ id: 'zoom-in', title: titleKey('zoomIn'), run: a.zoomIn })
  if (a.zoomOut) cmds.push({ id: 'zoom-out', title: titleKey('zoomOut'), run: a.zoomOut })
  if (a.zoomReset) cmds.push({ id: 'zoom-reset', title: titleKey('zoomReset'), run: a.zoomReset })
  if (a.pastePlainText) cmds.push({ id: 'paste-plain-text', title: titleKey('menuPastePlain'), run: a.pastePlainText })
  if (a.openNavigation) cmds.push({ id: 'go-to-heading', title: titleKey('goToHeading'), run: a.openNavigation })
  return cmds
}

/** Normalise for search: lower-case, Arabic→Persian letters, strip ZWNJ/ZWJ,
 *  Arabic diacritics, and whitespace — so a spaced query matches a
 *  ZWNJ-joined Persian title and vice versa. */
export function normalizeSearch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u064B-\u0655\u0670]/g, '')
    .replace(/[\u200C\u200D\s]/g, '')
    .replace(/ك/g, 'ک')
    .replace(/ي/g, 'ی')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/إ|أ|آ/g, 'ا')
    .trim()
}

function isSubsequence(needle: string, haystack: string): boolean {
  let j = 0
  for (let i = 0; i < haystack.length && j < needle.length; i++) {
    if (haystack[i] === needle[j]) j++
  }
  return j === needle.length
}

/** True when the query matches the title (substring wins over fuzzy). */
export function matchesCommand(title: string, query: string): boolean {
  const q = normalizeSearch(query)
  if (!q) return true
  const t = normalizeSearch(title)
  if (t.includes(q)) return true
  return isSubsequence(q, t)
}

/** Filter commands by query, substring matches first, original order kept within each rank. */
export function filterCommands(cmds: PaletteCommand[], query: string, lang: UiLang): PaletteCommand[] {
  const q = normalizeSearch(query)
  if (!q) return [...cmds]
  const ranked = cmds
    .map((c, i) => {
      const t = normalizeSearch(c.title(lang))
      const rank = t.includes(q) ? 0 : isSubsequence(q, t) ? 1 : -1
      return { c, i, rank }
    })
    .filter((r) => r.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
  return ranked.map((r) => r.c)
}

/**
 * The palette chord. Uses e.code (physical key) so it works under a
 * Persian/Farsi keyboard layout, where e.key for the same key is not 'k'.
 * Plain typing (no modifier) never matches — this is a pure guard.
 */
export function isPaletteShortcut(e: { code: string; ctrlKey: boolean; metaKey: boolean; altKey?: boolean }): boolean {
  return e.code === 'KeyK' && (e.ctrlKey || e.metaKey) && !e.altKey
}

/** Recent commands: newest first, de-duplicated, capped. Storage failures are ignored. */
export function loadRecentCommands(storage: Pick<Storage, 'getItem'>): string[] {
  try {
    const raw = storage.getItem(RECENT_COMMANDS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT_COMMANDS)
  } catch {
    return []
  }
}

export function recordRecentCommand(storage: Pick<Storage, 'getItem' | 'setItem'>, id: string): string[] {
  const next = [id, ...loadRecentCommands(storage).filter((x) => x !== id)].slice(0, MAX_RECENT_COMMANDS)
  try {
    storage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(next))
  } catch {
    /* best-effort */
  }
  return next
}
