import { useEffect, useState } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { tr, type UiLang, type I18nKey } from '../lib/i18n'
import { usePanelFocusReturn } from './useDialogFocus'
import {
  INTELLIGENCE_GROUPS, actionsForGroup, actionNeedsSelection,
  disconnectedProvider, truncatePreview, type IntelligenceAction, type IntelligenceGroup,
} from '../lib/intelligence'

// Vyro Intelligence panel (Mission 2, M2-10 = owner spec §1).
// ARCHITECTURE + UI ONLY: no AI service is connected, so every Run control
// is guarded — clicking one shows the needs-connection message and produces
// NO suggestion, NO replacement and NO document change. The original-vs-
// suggestion compare area stays empty while disconnected; no suggestion
// text is ever invented or rendered here. Follows the StatsPanel /
// ComparePanel pattern: a versions-panel shell with find-row controls and
// a × close button, rendered in edit mode only by Editor.tsx.
const GROUP_LABEL: Record<IntelligenceGroup, I18nKey> = {
  rewrite: 'intelligenceGroupRewrite',
  improve: 'intelligenceGroupImprove',
  summarize: 'intelligenceGroupSummarize',
  create: 'intelligenceGroupCreate',
  translate: 'intelligenceGroupTranslate',
}

export default function IntelligencePanel({ editor, lang, onClose }: {
  editor: Editor
  lang: UiLang
  onClose: () => void
}) {
  const t = (k: I18nKey) => tr(lang, k)
  // M2-15: focus returns to the opener on close (Esc already closed via
  // the window listener below).
  usePanelFocusReturn()
  const [notice, setNotice] = useState('')
  const [lastAction, setLastAction] = useState<IntelligenceAction | null>(null)
  const sel = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      if (!ed) return { text: '' }
      const { from, to } = ed.state.selection
      return { text: from === to ? '' : ed.state.doc.textBetween(from, to, '\n') }
    },
  })
  const selectedText = sel?.text ?? ''
  const hasSelection = selectedText.trim().length > 0

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Guarded run: the provider is disconnected, so this can only ever show
  // the needs-connection message. It never calls for a suggestion, never
  // writes to the editor, and never stores anything.
  const runAction = (action: IntelligenceAction) => {
    setLastAction(action)
    setNotice(t('intelligenceNeedsConnection'))
    void disconnectedProvider.getConnectionStatus()
  }

  return (
    <div className="versions-panel intelligence-panel" role="region" aria-label={t('intelligence')}>
      <div className="find-row">
        <span className="find-preview-label">{t('intelligence')}</span>
        <button type="button" className="rbtn" onClick={onClose} aria-label={t('close')}>×</button>
      </div>
      <div className="intelligence-banner" role="status">{t('intelligenceStatusNeedsConnection')}</div>
      <p className="muted">{t('intelligenceNoConnectionNote')}</p>
      <p className="muted">{t('intelligenceSelectionNote')}</p>
      <div className="find-row">
        <span className="find-preview-label">{t('intelligenceSelectedPreview')}</span>
        {hasSelection
          ? <span className="find-meta" dir="auto">{truncatePreview(selectedText)}</span>
          : <span className="muted">{t('intelligenceNoSelection')}</span>}
      </div>
      {INTELLIGENCE_GROUPS.map((group) => (
        <div key={group} className="intelligence-group">
          <div className="find-preview-label">{t(GROUP_LABEL[group])}</div>
          <div className="intelligence-actions">
            {actionsForGroup(group).map((action) => {
              const needsSel = actionNeedsSelection(action)
              const disabled = needsSel && !hasSelection
              return (
                <button
                  key={action.id}
                  type="button"
                  className="rbtn small"
                  disabled={disabled}
                  title={disabled ? t('intelligenceNoSelection') : undefined}
                  onClick={() => runAction(action)}
                >
                  {t(action.labelKey as I18nKey)} · {t('intelligenceRun')}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      {notice && (
        <div className="find-meta" role="status">
          {lastAction ? `${t(lastAction.labelKey as I18nKey)} — ` : ''}{notice}
        </div>
      )}
      <div className="intelligence-compare">
        <div className="find-preview-label">{t('intelligenceCompareTitle')}</div>
        <div className="compare-row">
          <div className="compare-col">
            <span className="find-preview-label">{t('intelligenceOriginal')}</span>
            <div className="diff-line" dir="auto">{hasSelection ? truncatePreview(selectedText) : t('intelligenceNoSelection')}</div>
          </div>
          <div className="compare-col">
            <span className="find-preview-label">{t('intelligenceSuggestion')}</span>
            <div className="diff-line" dir="auto">{t('intelligenceSuggestionEmpty')}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
