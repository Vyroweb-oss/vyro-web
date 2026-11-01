// Command palette overlay (Mission 2, M2-1). Full keyboard operation:
// ArrowUp/Down moves, Enter runs, Esc closes, focus returns to the element
// that had it before opening. No prompt/confirm/alert anywhere.
//
// P2-14: configurable palette shortcuts. The palette is always mounted by
// App, so its hooks run even while closed — the global keydown effect below
// uses that to fire custom chords app-wide without touching App.tsx.
// TipTap editor chords (Ctrl+B, …) are NOT rebindable here; see shortcuts.ts.
import { useEffect, useMemo, useRef, useState } from 'react'
import { filterCommands, isPaletteShortcut, loadRecentCommands, recordRecentCommand, type PaletteCommand } from '../lib/commands'
import { tr, type UiLang } from '../lib/i18n'
import { isPlainFieldTarget } from '../lib/keyboard'
import {
  applyCustomShortcuts,
  assignCustomShortcut,
  chordFromEvent,
  clearCustomShortcut,
  formatChord,
  isCustomizableCommand,
  isModifierCode,
  loadCustomShortcuts,
  matchCustomShortcut,
  saveCustomShortcuts,
  type ChordError,
  type CustomShortcutMap,
} from '../lib/shortcuts'
import { useDialogFocus } from './useDialogFocus'

const ERROR_KEY: Record<ChordError, Parameters<typeof tr>[1]> = {
  'no-mod': 'shortcutErrorNoMod',
  reserved: 'shortcutErrorReserved',
  builtin: 'shortcutErrorBuiltin',
  duplicate: 'shortcutErrorDuplicate',
  palette: 'shortcutErrorPalette',
}

export default function CommandPalette({ open, onClose, commands, lang }: {
  open: boolean
  onClose: () => void
  commands: PaletteCommand[]
  lang: UiLang
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [recent, setRecent] = useState<string[]>(() => loadRecentCommands(localStorage))
  const [view, setView] = useState<'list' | 'customize'>('list')
  const [customMap, setCustomMap] = useState<CustomShortcutMap>(() => loadCustomShortcuts(localStorage))
  const [capturingId, setCapturingId] = useState<string | null>(null)
  const [captureError, setCaptureError] = useState<ChordError | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // M2-15: Tab trapped inside the palette; Esc + focus return ride along
  // (App's closePalette also restores — same opener, idempotent). Input
  // autofocus stays with the existing rAF effect below.
  const containerRef = useRef<HTMLDivElement>(null)
  useDialogFocus(open, { containerRef, onClose, autofocus: false, trap: true })

  // P2-14: overlay custom chords as display labels (unassigned commands
  // keep their original object, so run() behaviour is untouched).
  const displayed = useMemo(() => applyCustomShortcuts(commands, customMap), [commands, customMap])

  const recentCmds = useMemo(
    () => recent.map((id) => displayed.find((c) => c.id === id)).filter((c): c is PaletteCommand => !!c),
    [recent, displayed],
  )
  const shown = useMemo(() => {
    if (query.trim()) return filterCommands(displayed, query, lang)
    return displayed
  }, [query, displayed, lang])
  // Flat list for keyboard navigation: recent section first when no query.
  const flat: PaletteCommand[] = query.trim() ? shown : [...recentCmds, ...shown.filter((c) => !recentCmds.some((r) => r.id === c.id))]

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      setRecent(loadRecentCommands(localStorage))
      // Reload so edits (here or elsewhere) take effect on next open.
      setCustomMap(loadCustomShortcuts(localStorage))
      setView('list')
      setCapturingId(null)
      setCaptureError(null)
      // Focus after paint so the input is mounted.
      const id = requestAnimationFrame(() => inputRef.current?.focus())
      return () => cancelAnimationFrame(id)
    }
  }, [open])
  useEffect(() => { setSelected(0) }, [query])
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  // P2-14: fire custom chords while the palette is CLOSED. Plain-field
  // targets never trigger (typing must stay typing), the palette chord is
  // never hijacked, and a matched command is recorded as recent + run.
  useEffect(() => {
    if (open) return
    const handler = (e: KeyboardEvent) => {
      if (isPlainFieldTarget(e.target as { tagName?: string; isContentEditable?: boolean } | null)) return
      if (isPaletteShortcut(e)) return
      const id = matchCustomShortcut(customMap, e)
      if (!id) return
      const cmd = commands.find((c) => c.id === id)
      if (!cmd) return
      e.preventDefault()
      recordRecentCommand(localStorage, cmd.id)
      cmd.run()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, customMap, commands])

  // P2-14: capture the next chord while assigning. Not while typing in a
  // text field (the palette's own search input included); bare modifier
  // keys are waited out, Esc cancels. Invalid chords show their error and
  // keep capturing so the user can retry; valid chords save immediately.
  useEffect(() => {
    if (!open || view !== 'customize' || !capturingId) return
    const handler = (e: KeyboardEvent) => {
      if (isPlainFieldTarget(e.target as { tagName?: string; isContentEditable?: boolean } | null)) return
      if (e.key === 'Escape') { e.preventDefault(); setCapturingId(null); setCaptureError(null); return }
      if (!e.code || isModifierCode(e.code)) return
      e.preventDefault()
      const { map, error } = assignCustomShortcut(customMap, capturingId, chordFromEvent(e))
      if (error) { setCaptureError(error); return }
      saveCustomShortcuts(localStorage, map)
      setCustomMap(map)
      setCapturingId(null)
      setCaptureError(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, view, capturingId, customMap])

  if (!open) return null

  const run = (cmd: PaletteCommand) => {
    recordRecentCommand(localStorage, cmd.id)
    onClose()
    cmd.run()
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => (flat.length ? (s + 1) % flat.length : 0)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => (flat.length ? (s - 1 + flat.length) % flat.length : 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const cmd = flat[selected]; if (cmd) run(cmd) }
  }

  const renderItem = (cmd: PaletteCommand, index: number) => (
    <button key={cmd.id} type="button" data-index={index} role="option" aria-selected={index === selected}
      className={`cmd-item${index === selected ? ' selected' : ''}`}
      onMouseEnter={() => setSelected(index)}
      onClick={() => run(cmd)}>
      <span dir="auto">{cmd.title(lang)}</span>
      {cmd.shortcut && <kbd className="cmd-shortcut">{cmd.shortcut}</kbd>}
    </button>
  )

  let flatIndex = -1
  const nextIndex = () => { flatIndex += 1; return flatIndex }

  const backToList = () => { setView('list'); setCapturingId(null); setCaptureError(null) }
  const clearRow = (id: string) => {
    const next = clearCustomShortcut(customMap, id)
    saveCustomShortcuts(localStorage, next)
    setCustomMap(next)
  }
  const resetAll = () => {
    saveCustomShortcuts(localStorage, {})
    setCustomMap({})
    setCapturingId(null)
    setCaptureError(null)
  }

  // P2-14 customize view: stable commands only (dynamic go-to-heading ids
  // are excluded — their indices shift with the document).
  const stableCmds = commands.filter((c) => isCustomizableCommand(c.id))

  return (
    <div className="modal-backdrop cmd-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cmd-palette" role="dialog" aria-label={tr(lang, 'commandPalette')} ref={containerRef} onMouseDown={(e) => e.stopPropagation()}>
        {view === 'list' ? (
          <>
            <div className="cmd-search-row">
              <span aria-hidden="true">⌘</span>
              <input ref={inputRef} value={query} dir="auto" placeholder={tr(lang, 'commandPalettePlaceholder')}
                aria-label={tr(lang, 'commandPalette')} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown} />
              <kbd className="cmd-shortcut">Esc</kbd>
            </div>
            <div className="cmd-list" role="listbox" ref={listRef}>
              {!query.trim() && recentCmds.length > 0 && (
                <>
                  <div className="cmd-section">{tr(lang, 'commandPaletteRecent')}</div>
                  {recentCmds.map((c) => renderItem(c, nextIndex()))}
                  <div className="cmd-section">{tr(lang, 'commandPaletteAll')}</div>
                  {shown.filter((c) => !recentCmds.some((r) => r.id === c.id)).map((c) => renderItem(c, nextIndex()))}
                </>
              )}
              {query.trim() && (shown.length === 0
                ? <p className="cmd-empty">{tr(lang, 'commandPaletteNoResults')}</p>
                : shown.map((c) => renderItem(c, nextIndex())))}
              {!query.trim() && recentCmds.length === 0 && shown.map((c) => renderItem(c, nextIndex()))}
              <div role="presentation" className="row">
                <button type="button" onClick={() => setView('customize')}>{tr(lang, 'customizeShortcuts')}</button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="cmd-section">{tr(lang, 'customizeShortcuts')}</div>
            <div className="cmd-list" ref={listRef}>
              {stableCmds.map((cmd) => {
                const chord = customMap[cmd.id]
                const capturing = capturingId === cmd.id
                return (
                  <div key={cmd.id} className="row">
                    <span dir="auto">{cmd.title(lang)}</span>
                    {chord
                      ? <kbd className="cmd-shortcut">{formatChord(chord)}</kbd>
                      : <span className="muted">—</span>}
                    {capturing ? (
                      <>
                        <span className="muted">{tr(lang, 'shortcutPressKey')}</span>
                        <button type="button" onClick={() => { setCapturingId(null); setCaptureError(null) }}>{tr(lang, 'cancel')}</button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="primary small" onClick={() => { setCapturingId(cmd.id); setCaptureError(null) }}>{tr(lang, 'shortcutSet')}</button>
                        {chord && <button type="button" onClick={() => clearRow(cmd.id)}>{tr(lang, 'shortcutClear')}</button>}
                      </>
                    )}
                  </div>
                )
              })}
              {captureError && <p className="muted">{tr(lang, ERROR_KEY[captureError])}</p>}
              <div role="presentation" className="row">
                <button type="button" onClick={backToList}>{tr(lang, 'shortcutBack')}</button>
                <button type="button" onClick={resetAll}>{tr(lang, 'resetSettings')}</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
