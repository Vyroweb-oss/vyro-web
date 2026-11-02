// Stage 2C — conflict resolution dialog.
//
// Shown for a document whose local edits the server never accepted
// because the server copy moved first. The local content is already
// preserved in Version History (the engine snapshots it when recording
// the conflict), and the dialog says so; the three choices map 1:1 onto
// conflictResolve.planConflictResolution, executed by useCloudSync.
// Nothing is applied until the user picks — closing the dialog leaves
// the document conflicted and untouched.

import { useRef, useState } from 'react'
import type { VyroDoc } from '../lib/types'
import { tr, type I18nKey, type UiLang } from '../lib/i18n'
import type { ConflictChoice } from '../lib/conflictResolve'
import { useDialogFocus } from './useDialogFocus'

const CHOICES: { choice: ConflictChoice; title: I18nKey; desc: I18nKey }[] = [
  { choice: 'mine', title: 'conflictMine', desc: 'conflictMineDesc' },
  { choice: 'server', title: 'conflictServer', desc: 'conflictServerDesc' },
  { choice: 'both', title: 'conflictBoth', desc: 'conflictBothDesc' },
]

export default function ConflictResolveModal({ doc, lang, onClose, onResolve }: {
  doc: VyroDoc
  lang: UiLang
  onClose: () => void
  onResolve: (choice: ConflictChoice) => Promise<boolean>
}) {
  const t = (k: I18nKey) => tr(lang, k)
  const modalRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState<ConflictChoice | null>(null)
  const [failed, setFailed] = useState(false)
  useDialogFocus(true, { containerRef: modalRef, onClose, autofocus: true, trap: true })

  const choose = async (choice: ConflictChoice) => {
    if (busy) return
    setBusy(choice)
    setFailed(false)
    let ok = false
    try { ok = await onResolve(choice) } catch { ok = false }
    setBusy(null)
    if (ok) onClose()
    else setFailed(true)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-label={t('conflictTitle')} onClick={(e) => e.stopPropagation()}>
        <h2>{t('conflictTitle')}</h2>
        <p><b>{doc.title}</b></p>
        <p>{t('conflictBody')}</p>
        <div className="conflict-choices">
          {CHOICES.map(({ choice, title, desc }) => (
            <button
              key={choice}
              type="button"
              className="conflict-choice"
              disabled={busy !== null}
              onClick={() => void choose(choice)}
            >
              <b>{t(title)}</b>
              <span>{t(desc)}</span>
            </button>
          ))}
        </div>
        {failed && <p role="alert">{t('conflictFailed')}</p>}
        <button type="button" onClick={onClose} disabled={busy !== null}>{t('conflictLater')}</button>
      </div>
    </div>
  )
}
