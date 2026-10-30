import { tr, type UiLang, type I18nKey } from '../lib/i18n'
import { storageLocation, type SaveDiagnostics, type SaveBackup, type SaveErrorKind } from '../lib/saveDiagnostics'
import type { VyroDoc } from '../lib/types'
import type { Editor } from '@tiptap/react'

// Autosave Diagnostics panel (Mission 2, M2-13 = owner spec §15). It
// follows the StatsPanel pattern: a read-only view over state owned by
// the editor (the diagnostics record + the local backup), with all
// actions going back through callbacks. It never touches the document,
// never uploads anything, and never shows document text — the failure
// rows carry only a count and an error kind.
export default function SaveDiagnosticsPanel({ doc, lang, diag, backup, autosaveEnabled, autosaveIntervalMs, hasPendingEdits, onRetry, onCreateBackup, onDownloadBackup, onClose }: {
  // Accepted for panel API consistency with StatsPanel/ComparePanel; the
  // panel deliberately acts only through callbacks and never edits the
  // document itself, so the editor instance is not dereferenced here.
  editor: Editor
  doc: VyroDoc
  lang: UiLang
  diag: SaveDiagnostics
  backup: SaveBackup | null
  autosaveEnabled: boolean
  autosaveIntervalMs: number
  hasPendingEdits: boolean
  onRetry: () => void
  onCreateBackup: () => void
  onDownloadBackup: () => void
  onClose: () => void
}) {
  const t = (k: I18nKey) => tr(lang, k)
  // The backup is a single-document snapshot: it counts for this panel
  // only when it belongs to the open document.
  const backupHere = backup && backup.docId === doc.id ? backup : null
  const statusText = diag.status === 'failed' ? t('saveFailedStatus')
    : diag.status === 'saving' ? t('saving')
    : diag.status === 'pending' ? t('saveUnsavedChanges')
    : t('saved')
  const errorKindKey: Record<SaveErrorKind, I18nKey> = {
    quota: 'saveErrorQuota',
    storage: 'saveErrorStorage',
    unknown: 'saveErrorUnknown',
  }
  const intervalText = autosaveIntervalMs >= 1000
    ? `${autosaveIntervalMs / 1000}s`
    : `${autosaveIntervalMs}ms`
  const location = storageLocation(false)

  return (
    <div className="save-diag-panel" role="region" aria-label={t('saveDiagnostics')}>
      <div className="find-row">
        <span className="find-preview-label">{t('saveDiagnostics')}</span>
        <button type="button" className="rbtn" onClick={onClose} aria-label={t('close')}>×</button>
      </div>
      <div className="diag-row"><span>{t('saveStatus')}</span><b>{statusText}</b></div>
      <div className="diag-row">
        <span>{t('saveLastSuccess')}</span>
        <b>{diag.lastSuccessAt ? new Date(diag.lastSuccessAt).toLocaleString() : t('saveNeverSaved')}</b>
      </div>
      <p className="muted">{location === 'local' ? t('saveStorageLocal') : t('saveStorageCloud')}</p>
      <div className="diag-row">
        <span>{autosaveEnabled ? t('saveAutosaveOn') : t('saveAutosaveOff')}</span>
        {autosaveEnabled && <span className="muted">{intervalText}</span>}
      </div>
      {diag.status === 'failed' && <>
        <div className="diag-row"><span>{t('saveFailureCount')}</span><b>{diag.failureCount}</b></div>
        {diag.lastErrorKind && <div className="diag-row"><span>{t('saveFailedStatus')}</span><b>{t(errorKindKey[diag.lastErrorKind])}</b></div>}
      </>}
      <div className="diag-row">
        <span>{backupHere ? t('saveBackupSaved') : t('saveBackupNone')}</span>
        {backupHere && <span className="muted">{new Date(backupHere.savedAt).toLocaleString()}</span>}
      </div>
      {hasPendingEdits && <p className="diag-warning">{t('saveUnsavedChanges')}</p>}
      <div className="row wrap">
        <button type="button" className="primary small" onClick={onRetry}>{t('saveRetryNow')}</button>
        <button type="button" className="rbtn" onClick={onCreateBackup}>{t('saveCreateBackup')}</button>
        {backupHere && <button type="button" className="rbtn" onClick={onDownloadBackup}>{t('saveDownloadBackup')}</button>}
      </div>
    </div>
  )
}
