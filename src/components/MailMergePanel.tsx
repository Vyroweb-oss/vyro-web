import { useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { tr, type UiLang } from '../lib/i18n'
import { jsonToPlainText } from '../lib/docText'
import {
  parseCsv,
  missingFields,
  substituteDoc,
  clampRecordIndex,
  navRecordIndex,
  type ParseCsvResult,
} from '../lib/mailMerge'

// PC2 Mailings — real local CSV mail merge. The CSV is parsed in the
// browser only and never uploaded; merged documents are created through
// the app's existing local createDoc path (the parent owns that wiring).
export default function MailMergePanel({ editor, doc, lang, onCreateMergedDocs, onClose }: {
  editor: Editor
  doc: { title: string }
  lang: UiLang
  onCreateMergedDocs?: (items: { title: string; content: any }[]) => void
  onClose: () => void
}) {
  const t = (k: Parameters<typeof tr>[1]) => tr(lang, k)
  const [csvText, setCsvText] = useState('')
  const [recordIdx, setRecordIdx] = useState(0)
  const [created, setCreated] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  const parsed: ParseCsvResult | null = useMemo(
    () => (csvText.trim() === '' ? null : parseCsv(csvText)),
    [csvText],
  )
  // Tier-1 S4b: the document snapshot must stay FRESH while the panel is
  // open. The old mount-time useMemo([editor]) meant edits made with the
  // panel open were invisible to the preview, the missing-field analysis
  // and even generation. We subscribe to editor updates and re-read the
  // JSON; the selected record is deliberately NOT reset by doc updates —
  // only by loading different CSV data (the existing handlers below).
  const [docVersion, setDocVersion] = useState(0)
  useEffect(() => {
    const bump = () => setDocVersion((v) => v + 1)
    editor.on('update', bump)
    return () => { editor.off('update', bump) }
  }, [editor])
  const docJson = useMemo(() => editor.getJSON(), [editor, docVersion])
  const missing = useMemo(
    () => (parsed && parsed.ok ? missingFields(docJson, parsed.fields) : []),
    [parsed, docJson],
  )
  const records = parsed && parsed.ok ? parsed.records : []
  const safeIdx = clampRecordIndex(recordIdx, records.length)
  const merged = useMemo(() => {
    if (records.length === 0) return null
    const { doc: mergedDoc, unsubstituted } = substituteDoc(docJson, records[safeIdx])
    return { text: jsonToPlainText(mergedDoc), unsubstituted }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, safeIdx, docJson])

  const errorText =
    parsed && !parsed.ok
      ? t(
          ({
            empty: 'mailCsvErrorEmpty',
            duplicateHeader: 'mailCsvErrorDuplicate',
            blankHeader: 'mailCsvErrorBlank',
            tooManyRecords: 'mailCsvErrorTooMany',
            unterminatedQuote: 'mailCsvErrorUnterminated',
          } as const)[parsed.error],
        ) + (parsed.detail ? `: ${parsed.detail}` : '')
      : ''

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const r = new FileReader()
    r.onerror = () => setCsvText('')
    r.onload = () => {
      setCsvText(String(r.result))
      setRecordIdx(0)
      setCreated(0)
    }
    r.readAsText(f)
  }

  const createDocs = () => {
    if (!onCreateMergedDocs || records.length === 0 || !parsed || !parsed.ok) return
    const firstField = parsed.fields[0]
    const items = records.map((rec, i) => ({
      title: `${doc.title} — ${rec[firstField] !== '' ? rec[firstField] : `${t('mailRecord')} ${i + 1}`}`,
      content: substituteDoc(docJson, rec).doc,
    }))
    onCreateMergedDocs(items)
    setCreated(items.length)
  }

  return (
    <div className="versions-panel mailmerge-panel" role="region" aria-label={t('mailMerge')}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
      <div className="find-row">
        <span className="find-preview-label">{t('mailMerge')}</span>
        <span className="muted">{t('mailMergeLocal')}</span>
        <button type="button" className="rbtn" onClick={onClose} aria-label={t('close')}>×</button>
      </div>
      <label className="field">{t('mailCsvLabel')}
        <textarea
          className="mailmerge-textarea"
          dir="ltr"
          value={csvText}
          placeholder={t('mailCsvPlaceholder')}
          rows={5}
          onChange={(e) => { setCsvText(e.target.value); setRecordIdx(0); setCreated(0) }}
        />
      </label>
      <div className="find-row">
        <button type="button" className="rbtn" onClick={() => fileRef.current?.click()}>{t('mailChooseCsv')}</button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onPickFile} />
        {parsed === null && <span className="muted">{t('mailNoCsv')}</span>}
        {errorText && <span className="versions-error" role="alert">{errorText}</span>}
      </div>
      {parsed && parsed.ok && (
        <>
          <div className="find-row">
            <span className="muted">{t('mailFields')}: {parsed.fields.join(', ')}</span>
            <span className="muted">{parsed.records.length} {t('mailRecordCount')}</span>
          </div>
          {missing.length > 0 && (
            <div className="versions-error" role="alert">
              {t('mailMissingFields')}: {missing.join(', ')}
            </div>
          )}
          {records.length === 0 && <p className="muted">{t('mailNoRecords')}</p>}
          {records.length > 0 && (
            <>
              <div className="find-row">
                <label>{t('mailRecord')}
                  <select
                    aria-label={t('mailRecord')}
                    value={safeIdx}
                    onChange={(e) => setRecordIdx(Number(e.target.value))}
                  >
                    {records.map((rec, i) => (
                      <option key={i} value={i}>
                        {i + 1}: {rec[parsed.fields[0]] !== '' ? rec[parsed.fields[0]] : `${t('mailRecord')} ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="rbtn" disabled={safeIdx <= 0} onClick={() => setRecordIdx(navRecordIndex(safeIdx, records.length, 'first'))}>{t('mailFirst')}</button>
                <button type="button" className="rbtn" disabled={safeIdx <= 0} onClick={() => setRecordIdx(navRecordIndex(safeIdx, records.length, 'prev'))}>{t('mailPrev')}</button>
                <span className="muted" aria-live="polite">{safeIdx + 1} / {records.length}</span>
                <button type="button" className="rbtn" disabled={safeIdx >= records.length - 1} onClick={() => setRecordIdx(navRecordIndex(safeIdx, records.length, 'next'))}>{t('mailNext')}</button>
                <button type="button" className="rbtn" disabled={safeIdx >= records.length - 1} onClick={() => setRecordIdx(navRecordIndex(safeIdx, records.length, 'last'))}>{t('mailLast')}</button>
              </div>
              {merged && merged.unsubstituted.length > 0 && (
                <div className="versions-error" role="alert">
                  {t('mailUnsubstituted')}: {merged.unsubstituted.join(', ')}
                </div>
              )}
              <div>
                <div className="find-preview-label">{t('mailPreview')}</div>
                <div className="version-preview-text" dir="auto">{merged?.text}</div>
              </div>
              <div className="find-row">
                <button type="button" className="primary small" onClick={createDocs}>
                  {t('mailCreateDocs')}
                </button>
                {created > 0 && (
                  <span className="muted">{created} {t('mailCreated')} — {t('mailCreatedHint')}</span>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
