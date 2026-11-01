import { useEffect, useRef, useState } from 'react'
import { SYMBOL_CATEGORIES, searchSymbols, symbolsForCategory, type SymbolCategoryId } from '../lib/symbols'
import { tr, type UiLang, type I18nKey } from '../lib/i18n'
import { useDialogFocus } from './useDialogFocus'

// Symbols panel (P2-13, Word parity Insert item). Presentation only:
// clicking a symbol calls onInsert and the dialog STAYS OPEN so several
// symbols can be inserted in a row; the Editor owns the actual insert.
// Esc closes, × closes, backdrop click closes, Tab is trapped and
// focus returns to the opener captured by the Editor before opening.
// The search input auto-focuses, so the hook runs with autofocus off
// — same arrangement as the link dialog.
// Esc needs a WINDOW listener (P2-15, IntelligencePanel pattern), not
// just useDialogFocus's container listener: the Editor's insertSymbol
// focuses the editor after every insert, so once a symbol has been
// inserted the keypress lands on the editor, never on the dialog
// container — and Esc from editor focus silently did nothing (P2-13
// live observation). The container listener stays for Tab trapping
// and for Esc from inside the dialog; calling onClose twice is
// harmless (the parent just sets the same open flag false).
const CATEGORY_LABEL: Record<SymbolCategoryId, I18nKey> = {
  punctuation: 'symbolsPunctuation',
  math: 'symbolsMath',
  currency: 'symbolsCurrency',
  arrows: 'symbolsArrows',
  greek: 'symbolsGreek',
}

export default function SymbolDialog({ open, onClose, onInsert, lang, opener }: {
  open: boolean
  onClose: () => void
  onInsert: (symbol: string) => void
  lang: UiLang
  opener?: Element | null
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [category, setCategory] = useState<SymbolCategoryId>('punctuation')
  const [query, setQuery] = useState('')
  useDialogFocus(open, { containerRef, onClose, autofocus: false, trap: true, opener })
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  const searching = query.trim() !== ''
  const entries = searching ? searchSymbols(query) : symbolsForCategory(category)
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal symbol-modal" role="dialog" aria-label={tr(lang, 'symbolsTitle')} ref={containerRef} onClick={(e) => e.stopPropagation()}>
        <div className="symbol-head">
          <h2>{tr(lang, 'symbolsTitle')}</h2>
          <button type="button" className="rbtn" aria-label={tr(lang, 'close')} onClick={onClose}>×</button>
        </div>
        <div className="symbol-tabs" role="tablist" aria-label={tr(lang, 'symbolsTitle')}>
          {SYMBOL_CATEGORIES.map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={category === c.id && !searching} className={`symbol-tab${category === c.id && !searching ? ' active' : ''}`} onClick={() => setCategory(c.id)}>{tr(lang, CATEGORY_LABEL[c.id])}</button>
          ))}
        </div>
        <input autoFocus className="symbol-search" type="search" value={query} placeholder={tr(lang, 'symbolsSearchPlaceholder')} aria-label={tr(lang, 'symbolsSearchPlaceholder')} onChange={(e) => setQuery(e.target.value)} />
        {entries.length === 0
          ? <p className="muted">{tr(lang, 'noMatchesFound')}</p>
          : <div className="symbol-grid">
            {entries.map((s) => (
              <button key={s.char} type="button" className="symbol-btn" title={s.name} aria-label={s.name} onClick={() => onInsert(s.char)}><span aria-hidden="true">{s.char}</span></button>
            ))}
          </div>}
        <p className="muted">{tr(lang, 'symbolsInsertHint')}</p>
      </div>
    </div>
  )
}
