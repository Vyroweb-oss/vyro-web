import { useRef } from 'react'
import { SHORTCUT_CATALOGUE, SHORTCUT_GROUP_LABEL, SHORTCUT_GROUP_ORDER } from '../lib/keyboard'
import { tr, type UiLang } from '../lib/i18n'
import { useDialogFocus } from './useDialogFocus'

// Keyboard Shortcuts help dialog (Mission 2, M2-15 = owner spec §17).
// Renders the audited catalogue from lib/keyboard.ts — nothing here is
// hand-typed, so the dialog can never claim a shortcut that does not
// work. Same .modal pattern as SettingsPanel; Esc closes, Tab is trapped,
// focus returns to the opener (via useDialogFocus).
export default function KeyboardShortcutsDialog({ open, onClose, lang }: {
  open: boolean
  onClose: () => void
  lang: UiLang
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  useDialogFocus(open, { containerRef, onClose, autofocus: true, trap: true })
  if (!open) return null
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal shortcut-modal" role="dialog" aria-label={tr(lang, 'keyboardShortcuts')} ref={containerRef} onClick={(e) => e.stopPropagation()}>
        <h2>{tr(lang, 'keyboardShortcuts')}</h2>
        {SHORTCUT_GROUP_ORDER.map((group) => (
          <div key={group} className="shortcut-group">
            <h3>{tr(lang, SHORTCUT_GROUP_LABEL[group])}</h3>
            {SHORTCUT_CATALOGUE.filter((s) => s.group === group).map((s) => (
              <div key={s.id} className="shortcut-row">
                <kbd className="cmd-shortcut">{s.keys}</kbd>
                <span>{tr(lang, s.label)}</span>
              </div>
            ))}
          </div>
        ))}
        <p className="muted">{tr(lang, 'shortcutReservedNote')}</p>
        <div className="row end"><button type="button" className="primary small" onClick={onClose}>{tr(lang, 'close')}</button></div>
      </div>
    </div>
  )
}
