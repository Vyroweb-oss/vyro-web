import { useEditorState, type Editor } from '@tiptap/react'
import { computeDocumentStats, computeReadability, computeSelectionStats } from '../lib/stats'
import { tr, type UiLang, type I18nKey } from '../lib/i18n'
import { usePanelFocusReturn } from './useDialogFocus'

// Document Statistics panel (Mission 2, M2-05 = owner spec §10). It follows
// the NavigationPane pattern: useEditorState re-renders it on every editor
// transaction and selection change, so both columns stay live with no
// polling and no stored state. Document stats come from the editor's JSON;
// the selection column appears only for a non-collapsed, non-blank
// selection (computeSelectionStats returns null otherwise). The selection
// text uses '\n' block separators, matching the document stats' joining.
export default function StatsPanel({ editor, lang, pages, onClose }: {
  editor: Editor
  lang: UiLang
  /** Tier-1 S2: the editor's REAL paginated page count (from the measure
   *  pass state), never the words-per-page heuristic. */
  pages: number
  onClose: () => void
}) {
  const t = (k: I18nKey) => tr(lang, k)
  // M2-15: Esc closes (root handler below), focus returns to the opener.
  usePanelFocusReturn()
  const state = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      if (!ed) return { json: null, selText: '', hasSelection: false }
      const { from, to } = ed.state.selection
      return {
        json: ed.getJSON(),
        selText: from === to ? '' : ed.state.doc.textBetween(from, to, '\n'),
        hasSelection: from !== to,
      }
    },
  })
  const stats = computeDocumentStats(state?.json)
  const readability = computeReadability(state?.json)
  const sel = state?.hasSelection ? computeSelectionStats(state?.selText) : null

  const headingParts = (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const)
    .filter((k) => stats.headingsByLevel[k] > 0)
    .map((k) => `${k.toUpperCase()} ${stats.headingsByLevel[k]}`)
  const avg = Number.isInteger(stats.avgSentenceLength)
    ? String(stats.avgSentenceLength)
    : stats.avgSentenceLength.toFixed(1)
  const readUnit = lang === 'fa' ? 'دقیقه' : 'min'

  const rows: [I18nKey, string][] = [
    ['statsWords', String(stats.words)],
    ['statsPages', String(pages)],
    ['statsCharsWithSpaces', String(stats.charsWithSpaces)],
    ['statsCharsWithoutSpaces', String(stats.charsWithoutSpaces)],
    ['statsParagraphs', String(stats.paragraphs)],
    ['statsHeadings', stats.headingsTotal === 0 ? '0' : `${stats.headingsTotal} (${headingParts.join(' · ')})`],
    ['statsTables', String(stats.tables)],
    ['statsImages', String(stats.images)],
    ['statsSentences', String(stats.sentences)],
    ['statsAvgSentenceLength', avg],
    // The reading-time row is an estimate and says so in its LABEL.
    // Pages are NOT estimated: the statsPages row above shows the real
    // paginated count passed in from the editor's measure pass.
    ['statsReadingTimeEstimate', `${stats.readingTimeMinutes} ${readUnit}`],
    // P2-7 readability: English-only estimate, shown only when computable.
    ...(readability ? [
      ['statsReadabilityEase', readability.fleschEase.toFixed(1)],
      ['statsReadabilityGrade', readability.fleschKincaidGrade.toFixed(1)],
    ] as [I18nKey, string][] : []),
  ]
  const selRows: [I18nKey, string][] = sel ? [
    ['statsWords', String(sel.words)],
    ['statsCharsWithSpaces', String(sel.charsWithSpaces)],
    ['statsCharsWithoutSpaces', String(sel.charsWithoutSpaces)],
  ] : []
  const column = (title: string, data: [I18nKey, string][]) => (
    <div className="stats-column">
      <div className="stats-column-title">{title}</div>
      <dl className="stats-rows">
        {data.map(([key, value]) => (
          <div className="stats-row" key={key}>
            <dt>{t(key)}</dt>
            <dd dir="auto">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )

  return (
    <div className="stats-panel" role="region" aria-label={t('documentStatistics')}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
      <div className="find-row">
        <span className="find-preview-label">{t('documentStatistics')}</span>
        <button type="button" className="rbtn" onClick={onClose} aria-label={t('close')}>×</button>
      </div>
      <div className={`stats-grid${sel ? ' has-selection' : ''}`}>
        {column(t('statsDocument'), rows)}
        {sel && column(t('statsSelection'), selRows)}
      </div>
      <p className="muted">{t('statsLive')}</p>
      {!readability && <p className="muted">{t('statsReadabilityNeedsEnglish')}</p>}
    </div>
  )
}
