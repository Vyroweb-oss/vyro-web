import { useEffect, useMemo } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { analyzeDoc, type A11yIssue, type A11yIssueKind } from '../lib/a11y'
import { tr, type UiLang, type I18nKey } from '../lib/i18n'
import { usePanelFocusReturn } from './useDialogFocus'

// Accessibility Checker panel (Mission 2, P2-5 — a Word-gap feature).
// Diagnostic display ONLY, following the StatsPanel pattern: it reads the
// editor's live JSON on every transaction and never mutates the document,
// and it offers no jump or fix actions. Contrast is deliberately not
// checked (it needs rendered styles, which JSON cannot establish).
const GROUP_ORDER: { kind: A11yIssueKind; labelKey: I18nKey }[] = [
  { kind: 'imageAltMissing', labelKey: 'a11yImageAltMissing' },
  { kind: 'headingSkip', labelKey: 'a11yHeadingSkip' },
  { kind: 'headingEmpty', labelKey: 'a11yHeadingEmpty' },
  { kind: 'tableNoHeader', labelKey: 'a11yTableNoHeader' },
  { kind: 'linkEmptyText', labelKey: 'a11yLinkEmptyText' },
  { kind: 'firstHeadingNotH1', labelKey: 'a11yFirstHeadingNotH1' },
]

function issueLabel(t: (k: I18nKey) => string, issue: A11yIssue): string {
  switch (issue.kind) {
    case 'imageAltMissing':
      return `${t('a11yImage')} ${issue.imageIndex}`
    case 'tableNoHeader':
      return `${t('a11yTable')} ${issue.tableIndex}`
    case 'headingSkip':
      return issue.headingText
        ? `H${issue.prevLevel} → H${issue.level}: ${issue.headingText}`
        : `H${issue.prevLevel} → H${issue.level}`
    case 'headingEmpty':
      return `${t('a11yHeading')} ${issue.headingIndex}`
    case 'linkEmptyText':
      return `${t('a11yLink')} ${issue.linkIndex}`
    case 'firstHeadingNotH1':
      return issue.headingText
        ? `H${issue.level}: ${issue.headingText}`
        : `H${issue.level}`
    default:
      return ''
  }
}

export default function AccessibilityPanel({ editor, lang, onClose }: {
  editor: Editor
  lang: UiLang
  onClose: () => void
}) {
  const t = (k: I18nKey) => tr(lang, k)
  // Esc closes from ANY focus (window listener, IntelligencePanel pattern):
  // the panel's only focusable control is its × button, so a root-div
  // onKeyDown never fires when focus sits on the ribbon button or on
  // non-focusable panel text — the live check proved exactly that.
  // Focus returns to the opener on unmount (usePanelFocusReturn).
  usePanelFocusReturn()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const state = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({ json: ed ? ed.getJSON() : null }),
  })
  const result = useMemo(() => analyzeDoc(state?.json), [state?.json])

  return (
    <div className="a11y-panel" role="region" aria-label={t('accessibilityChecker')}>
      <div className="find-row">
        <span className="find-preview-label">{t('accessibilityChecker')}</span>
        <button type="button" className="rbtn" onClick={onClose} aria-label={t('close')}>×</button>
      </div>
      <div className="find-meta">
        {t('a11yIssues')}: {result.total}
      </div>
      {result.total === 0 ? (
        <p className="muted">{t('a11yNoIssues')}</p>
      ) : (
        GROUP_ORDER.filter((g) => result.counts[g.kind] > 0).map((g) => (
          <div className="a11y-group" key={g.kind}>
            <div className="a11y-group-title">{t(g.labelKey)} ({result.counts[g.kind]})</div>
            <ul className="a11y-list">
              {result.issues.filter((i) => i.kind === g.kind).map((issue, idx) => (
                <li key={idx} dir="auto">{issueLabel(t, issue)}</li>
              ))}
            </ul>
          </div>
        ))
      )}
      <p className="muted">{t('a11yDiagnosticNote')}</p>
    </div>
  )
}
