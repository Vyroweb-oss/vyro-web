import { useEffect, useState } from 'react'
import { tr, type UiLang, type I18nKey } from '../lib/i18n'
import {
  EXPORT_PRESETS, EXPORT_PRESET_IDS, buildExportFilename, buildExportPreview,
  buildArchivePayload, type ExportPresetId, type ExportPreview,
} from '../lib/exportPresets'
import { jsonToPlainText } from '../lib/docx'
import { usePanelFocusReturn } from './useDialogFocus'
import type { VyroDoc } from '../lib/types'
import type { Editor } from '@tiptap/react'

// Export Presets panel (Mission 2, M2-14 = owner spec §16). It follows the
// StatsPanel/SaveDiagnosticsPanel pattern: a view over the editor's current
// JSON, with every export going back through callbacks owned by Editor.
// The panel itself never calls window.print, never creates a Blob or a
// download, and never bypasses premium gating — Editor wires onPrint to
// its existing gated(()=>window.print()) path. DOCX is deliberately NOT
// a preset here: the existing File-tab DOCX button stays the only DOCX
// path. The preview is recomputed when the panel opens, when the preset
// changes, and on Refresh — never on every keystroke.
export default function ExportPresetsPanel({ editor, doc, lang, onExportText, onExportHtml, onExportArchive, onPrint, onClose }: {
  editor: Editor
  doc: VyroDoc
  lang: UiLang
  onExportText: (filename: string, text: string, mime: string) => void
  onExportHtml: (filename: string, html: string) => void
  onExportArchive: (filename: string, payload: string) => void
  onPrint: () => void
  onClose: () => void
}) {
  const t = (k: I18nKey) => tr(lang, k)
  // M2-15: Esc closes (root handler below), focus returns to the opener.
  usePanelFocusReturn()
  const [preset, setPreset] = useState<ExportPresetId>('print-ready')
  const [filenameBase, setFilenameBase] = useState(doc.title)
  const [dateSuffix, setDateSuffix] = useState(false)
  const [preview, setPreview] = useState<ExportPreview>(() => buildExportPreview(editor.getJSON(), 'print-ready'))
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const refreshPreview = () => setPreview(buildExportPreview(editor.getJSON(), preset))
  useEffect(() => { refreshPreview() }, [preset]) // eslint-disable-line react-hooks/exhaustive-deps

  const def = EXPORT_PRESETS[preset]
  const filename = def.ext ? buildExportFilename(filenameBase, def.ext, { dateSuffix }) : ''

  const runExport = () => {
    setError('')
    setSuccess('')
    try {
      if (def.action === 'print') {
        onPrint()
        setSuccess(t('exportPrintStarted'))
        return
      }
      if (def.action === 'text') {
        onExportText(filename, jsonToPlainText(editor.getJSON()), 'text/plain')
      } else if (def.action === 'html') {
        onExportHtml(filename, editor.getHTML())
      } else {
        onExportArchive(filename, buildArchivePayload(doc.title, doc.dir, editor.getJSON()))
      }
      setSuccess(`${t('exportSuccess')} ${filename}`)
    } catch (err: any) {
      setSuccess('')
      setError(err?.message ? String(err.message) : t('exportFailed'))
    }
  }

  return (
    <div className="export-presets-panel" role="region" aria-label={t('exportPresets')}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
      <div className="find-row">
        <span className="find-preview-label">{t('exportPresets')}</span>
        <button type="button" className="rbtn" onClick={onClose} aria-label={t('close')}>×</button>
      </div>
      <p className="muted">{t('exportPresetsDesc')}</p>
      <div className="preset-selector" role="group" aria-label={t('exportPresets')}>
        {EXPORT_PRESET_IDS.map(id => (
          <button key={id} type="button" className={`preset-btn${preset === id ? ' active' : ''}`}
            aria-pressed={preset === id} onClick={() => setPreset(id)}>
            {t(EXPORT_PRESETS[id].labelKey)}
          </button>
        ))}
      </div>
      <p className="muted">{t(def.descKey)}</p>
      <div className="keeps-drops">
        <div>
          <span className="find-preview-label">{t('exportKeeps')}</span>
          <ul className="keeps-list">{def.keeps.map(k => <li key={k}>✓ {t(k)}</li>)}</ul>
        </div>
        <div>
          <span className="find-preview-label">{t('exportDrops')}</span>
          <ul className="drops-list">{def.drops.map(k => <li key={k}>✕ {t(k)}</li>)}</ul>
        </div>
      </div>
      <div className="find-row">
        <label className="find-preview-label" htmlFor="export-preset-filename">{t('exportFilename')}</label>
        <input id="export-preset-filename" value={filenameBase} dir="auto"
          onChange={e => setFilenameBase(e.target.value)} aria-label={t('exportFilename')} />
      </div>
      <label className="export-date-check">
        <input type="checkbox" checked={dateSuffix} onChange={e => setDateSuffix(e.target.checked)} />
        {t('exportDateSuffix')}
      </label>
      <div className="export-preview-box">
        <div className="find-row">
          <span className="find-preview-label">{t('exportPreview')}</span>
          <button type="button" className="rbtn" onClick={refreshPreview}>{t('exportRefreshPreview')}</button>
        </div>
        {filename && <div className="diag-row"><span>{t('exportFilename')}</span><b dir="auto">{filename}</b></div>}
        <div className="diag-row"><span>{t('exportKeepHeadings')}</span><b>{preview.structure.headings}</b></div>
        <div className="diag-row"><span>{t('exportParagraphs')}</span><b>{preview.structure.paragraphs}</b></div>
        <div className="diag-row"><span>{t('exportKeepTables')}</span><b>{preview.structure.tables}</b></div>
        <div className="diag-row"><span>{t('exportKeepImages')}</span><b>{preview.structure.images}</b></div>
        <div className="diag-row"><span>{t('exportKeepLinks')}</span><b>{preview.structure.links}</b></div>
        {preview.archiveNote
          ? <p className="muted">{t('exportArchiveNote')}</p>
          : <p className="export-preview-text" dir="auto">{preview.textPreview || t('exportNoPreview')}</p>}
      </div>
      {error && <div className="export-error" role="alert">{error}</div>}
      {success && <p className="export-success" role="status">{success}</p>}
      <div className="row wrap">
        <button type="button" className="primary small" onClick={runExport}>
          {def.action === 'print' ? t('exportPrint') : t('exportRun')}
        </button>
        <button type="button" className="rbtn" onClick={onClose}>{t('close')}</button>
      </div>
    </div>
  )
}
