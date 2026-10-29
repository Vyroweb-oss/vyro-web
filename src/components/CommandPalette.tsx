// Command palette overlay (Mission 2, M2-1). Full keyboard operation:
// ArrowUp/Down moves, Enter runs, Esc closes, focus returns to the element
// that had it before opening. No prompt/confirm/alert anywhere.
import { useEffect, useMemo, useRef, useState } from 'react'
import { filterCommands, loadRecentCommands, recordRecentCommand, type PaletteCommand } from '../lib/commands'
import { tr, type UiLang } from '../lib/i18n'

export default function CommandPalette({ open, onClose, commands, lang }: {
  open: boolean
  onClose: () => void
  commands: PaletteCommand[]
  lang: UiLang
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [recent, setRecent] = useState<string[]>(() => loadRecentCommands(localStorage))
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const recentCmds = useMemo(
    () => recent.map((id) => commands.find((c) => c.id === id)).filter((c): c is PaletteCommand => !!c),
    [recent, commands],
  )
  const shown = useMemo(() => {
    if (query.trim()) return filterCommands(commands, query, lang)
    return commands
  }, [query, commands, lang])
  // Flat list for keyboard navigation: recent section first when no query.
  const flat: PaletteCommand[] = query.trim() ? shown : [...recentCmds, ...shown.filter((c) => !recentCmds.some((r) => r.id === c.id))]

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      setRecent(loadRecentCommands(localStorage))
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

  return (
    <div className="modal-backdrop cmd-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cmd-palette" role="dialog" aria-label={tr(lang, 'commandPalette')} onMouseDown={(e) => e.stopPropagation()}>
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
        </div>
      </div>
    </div>
  )
}
