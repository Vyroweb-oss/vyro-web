import { useEffect, useMemo, useRef, useState } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { tr, type UiLang, type I18nKey } from '../lib/i18n'
import { compareDocs, renderComparisonReport, saveChosenSideAsVersion, type CompareLine, type DiffHunk } from '../lib/compare'
import { usePanelFocusReturn } from './useDialogFocus'
import { listVersions, loadVersions, saveVersions, type VersionSnapshot } from '../lib/versions'
import type { VyroDoc } from '../lib/types'

// Document Compare panel (Mission 2, M2-09 = owner spec §7). Follows the
// versions-panel pattern: pickers + find-row controls, inline errors, and
// saves through the versions store only. It NEVER mutates the open
// document — it only reads the editor's JSON and saved snapshots.
export default function ComparePanel({ editor, doc, versions, lang, onClose, onVersionsSaved }: {
  editor: Editor; doc: VyroDoc; versions: VersionSnapshot[]; lang: UiLang
  onClose: () => void; onVersionsSaved: (next: VersionSnapshot[]) => void
}) {
  const t = (k: I18nKey) => tr(lang, k)
  // M2-15: Esc closes (root handler below), focus returns to the opener.
  usePanelFocusReturn()
  // Live current-document JSON: re-renders on every transaction, so
  // "Current document" always reflects the latest keystrokes.
  const live = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({ json: ed ? ed.getJSON() : doc.content }),
  })
  const currentJson = live?.json ?? doc.content
  const docVersions = useMemo(() => listVersions(versions, doc.id), [versions, doc.id])

  const [selA, setSelA] = useState<string>('current')
  const [selB, setSelB] = useState<string>(() => docVersions[0]?.id ?? 'current')
  const [mode, setMode] = useState<'side' | 'inline'>('side')
  const [activeHunk, setActiveHunk] = useState(0)
  const [copyStatus, setCopyStatus] = useState('')
  const [showReport, setShowReport] = useState(false)
  const [saveSide, setSaveSide] = useState<'A' | 'B'>('A')
  const [saveLabel, setSaveLabel] = useState('')
  const [saveError, setSaveError] = useState('')
  const [saveStatus, setSaveStatus] = useState('')
  const hunkRefs = useRef<(HTMLDivElement | null)[]>([])

  const contentFor = (sel: string): unknown => {
    if (sel === 'current') return currentJson
    return docVersions.find((v) => v.id === sel)?.content ?? currentJson
  }
  const labelFor = (sel: string): string => {
    if (sel === 'current') return t('compareCurrent')
    const v = docVersions.find((x) => x.id === sel)
    if (!v) return t('compareCurrent')
    return v.label ? `${v.label} — ${new Date(v.createdAt).toLocaleString()}` : new Date(v.createdAt).toLocaleString()
  }
  const aContent = contentFor(selA)
  const bContent = contentFor(selB)
  const result = useMemo(() => compareDocs(aContent, bContent), [aContent, bContent])
  // Report is cheap plain text; computed directly so version labels are
  // never stale when the version list changes.
  const report = renderComparisonReport(labelFor(selA), labelFor(selB), result)
  const diffHunks = useMemo(() => result.hunks.filter((h) => h.type !== 'unchanged'), [result])
  useEffect(() => { if (activeHunk >= diffHunks.length) setActiveHunk(diffHunks.length ? diffHunks.length - 1 : 0) }, [diffHunks.length, activeHunk])

  const jumpTo = (idx: number) => {
    if (!diffHunks.length) return
    const next = ((idx % diffHunks.length) + diffHunks.length) % diffHunks.length
    setActiveHunk(next)
    hunkRefs.current[next]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
  const copyResult = async () => {
    try {
      await navigator.clipboard?.writeText(report)
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard')
      setCopyStatus(t('compareCopied'))
      setShowReport(false)
    } catch {
      setCopyStatus(t('compareCopyManual'))
      setShowReport(true)
    }
  }
  const saveChosenSide = () => {
    setSaveError('')
    setSaveStatus('')
    const chosen = saveSide === 'A' ? aContent : bContent
    const res = saveChosenSideAsVersion(loadVersions(localStorage), doc, chosen, saveLabel)
    if (!res) { setSaveError(t('versionSaveFailed')); return }
    if (!saveVersions(localStorage, res.versions)) { setSaveError(t('versionSaveFailed')); return }
    onVersionsSaved(res.versions)
    setSaveLabel('')
    setSaveStatus(t('compareSaved'))
  }

  const picker = (value: string, onChange: (v: string) => void, ariaLabel: string) => (
    <select aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="current">{t('compareCurrent')}</option>
      {docVersions.map((v) => (
        <option key={v.id} value={v.id}>
          {v.label ? `${v.label} — ${new Date(v.createdAt).toLocaleString()}` : new Date(v.createdAt).toLocaleString()}
        </option>
      ))}
    </select>
  )
  const renderLines = (lines: CompareLine[], cls: string) => (
    <>{lines.map((l, i) => <div key={i} className={cls} dir="auto">{l.text}</div>)}</>
  )

  // Map each rendered hunk to its diff-hunk index (-1 for unchanged).
  let diffCounter = -1
  const hunkDiffIndex = (h: DiffHunk): number => {
    if (h.type === 'unchanged') return -1
    diffCounter += 1
    return diffCounter
  }
  // NOTE: hunkDiffIndex is called once per hunk in render order below, so
  // diffCounter walks in step with the rendered list.
  const renderedHunks = result.hunks.map((h) => ({ h, di: hunkDiffIndex(h) }))

  return <div className="versions-panel compare-panel" role="region" aria-label={t('compare')}
    onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
    <div className="find-row">
      <span className="find-preview-label">{t('compare')}</span>
      <button type="button" className="rbtn" onClick={onClose} aria-label={t('close')}>×</button>
    </div>
    {docVersions.length === 0 && <p className="muted">{t('compareNoVersionsNote')}</p>}
    <div className="find-row">
      <label className="find-scope">{t('compareSideA')} {picker(selA, setSelA, t('compareSideA'))}</label>
      <label className="find-scope">{t('compareSideB')} {picker(selB, setSelB, t('compareSideB'))}</label>
    </div>
    <div className="find-row">
      <div className="find-scope" role="group" aria-label={t('compare')}>
        <button type="button" className={`rbtn small${mode === 'side' ? ' active' : ''}`} onClick={() => setMode('side')}>{t('compareModeSideBySide')}</button>
        <button type="button" className={`rbtn small${mode === 'inline' ? ' active' : ''}`} onClick={() => setMode('inline')}>{t('compareModeInline')}</button>
      </div>
      <span className="find-meta" dir="auto">
        {t('compareAdded')}: {result.summary.added} · {t('compareRemoved')}: {result.summary.removed} · {t('compareChanged')}: {result.summary.changed} · {t('compareDiffHunks')}: {result.summary.diffHunks}
      </span>
    </div>
    <div className="find-row">
      <button type="button" className="rbtn small" disabled={diffHunks.length === 0} onClick={() => jumpTo(activeHunk - 1)}>{t('comparePrev')}</button>
      <button type="button" className="rbtn small" disabled={diffHunks.length === 0} onClick={() => jumpTo(activeHunk + 1)}>{t('compareNext')}</button>
      <span className="find-meta">
        {diffHunks.length === 0 ? t('compareNoDifferences') : `${t('compareHunk')} ${activeHunk + 1} ${t('compareOf')} ${diffHunks.length}`}
      </span>
      <button type="button" className="primary small" onClick={() => void copyResult()}>{t('compareCopyResult')}</button>
    </div>
    {copyStatus && <div className="find-meta" role="status">{copyStatus}</div>}
    {showReport && <textarea className="compare-report" readOnly value={report} rows={10} aria-label={t('compareCopyResult')} />}
    {result.summary.diffHunks === 0
      ? <p className="muted">{t('compareNoDifferences')}</p>
      : <div className="compare-diff">
          {renderedHunks.map(({ h, di }, hi) => {
            const active = di >= 0 && di === activeHunk
            const cls = `diff-hunk${active ? ' diff-hunk-active' : ''}`
            if (mode === 'inline') {
              return <div key={hi} ref={(el) => { if (di >= 0) hunkRefs.current[di] = el }} className={cls}>
                {h.type === 'unchanged' && renderLines(h.aLines, 'diff-line')}
                {h.type === 'changed' && h.aLines.map((l, i) => (
                  <div key={i}>
                    <div className="diff-line diff-removed" dir="auto">{l.text}</div>
                    <div className="diff-line diff-added" dir="auto">{h.bLines[i].text}</div>
                  </div>
                ))}
                {h.type === 'removed' && renderLines(h.aLines, 'diff-line diff-removed')}
                {h.type === 'added' && renderLines(h.bLines, 'diff-line diff-added')}
              </div>
            }
            return <div key={hi} ref={(el) => { if (di >= 0) hunkRefs.current[di] = el }} className={`${cls} compare-row`}>
              <div className="compare-col">
                {h.type === 'unchanged' && renderLines(h.aLines, 'diff-line')}
                {h.type === 'changed' && renderLines(h.aLines, 'diff-line diff-changed')}
                {h.type === 'removed' && renderLines(h.aLines, 'diff-line diff-removed')}
                {h.type === 'added' && <div className="diff-line diff-empty"> </div>}
              </div>
              <div className="compare-col">
                {h.type === 'unchanged' && renderLines(h.bLines, 'diff-line')}
                {h.type === 'changed' && renderLines(h.bLines, 'diff-line diff-changed')}
                {h.type === 'added' && renderLines(h.bLines, 'diff-line diff-added')}
                {h.type === 'removed' && <div className="diff-line diff-empty"> </div>}
              </div>
            </div>
          })}
        </div>}
    <div className="find-row">
      <label className="find-scope">{t('compareSaveChosenSide')}
        <select aria-label={t('compareSaveChosenSide')} value={saveSide} onChange={(e) => setSaveSide(e.target.value as 'A' | 'B')}>
          <option value="A">{t('compareSideA')}</option>
          <option value="B">{t('compareSideB')}</option>
        </select>
      </label>
      <input value={saveLabel} dir="auto" onChange={(e) => setSaveLabel(e.target.value)} placeholder={t('versionNamePlaceholder')} aria-label={t('versionNamePlaceholder')} />
      <button type="button" className="primary small" onClick={saveChosenSide}>{t('versionSave')}</button>
    </div>
    {saveError && <div className="versions-error" role="alert">{saveError}</div>}
    {saveStatus && <div className="find-meta" role="status">{saveStatus}</div>}
  </div>
}
