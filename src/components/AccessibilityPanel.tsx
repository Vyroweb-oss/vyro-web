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
  { kind: 'tableMergedCells', labelKey: 'a11yTableMergedCells' },
  { kind: 'linkEmptyText', labelKey: 'a11yLinkEmptyText' },
  { kind: 'firstHeadingNotH1', labelKey: 'a11yFirstHeadingNotH1' },
  { kind: 'linkVagueText', labelKey: 'a11yLinkVagueText' },
  { kind: 'imageAltTooLong', labelKey: 'a11yImageAltTooLong' },
  { kind: 'headingDuplicateText', labelKey: 'a11yHeadingDuplicateText' },
  { kind: 'headingNoContent', labelKey: 'a11yHeadingNoContent' },
  { kind: 'imageAltDuplicate', labelKey: 'a11yImageAltDuplicate' },
  { kind: 'imageAltIsFilename', labelKey: 'a11yImageAltIsFilename' },
  { kind: 'imageAltVague', labelKey: 'a11yImageAltVague' },
  { kind: 'linkTextIsUrl', labelKey: 'a11yLinkTextIsUrl' },
  { kind: 'linkSameTextDifferentTarget', labelKey: 'a11yLinkSameTextDifferentTarget' },
  { kind: 'linkMissingHref', labelKey: 'a11yLinkMissingHref' },
  { kind: 'headingTooLong', labelKey: 'a11yHeadingTooLong' },
  { kind: 'headingMultipleH1', labelKey: 'a11yHeadingMultipleH1' },
  { kind: 'imageAltRedundantPrefix', labelKey: 'a11yImageAltRedundantPrefix' },
  { kind: 'tableEmptyCells', labelKey: 'a11yTableEmptyCells' },
  { kind: 'linkSameTargetDifferentText', labelKey: 'a11yLinkSameTargetDifferentText' },
  { kind: 'tableHeaderNotFirstRow', labelKey: 'a11yTableHeaderNotFirstRow' },
  { kind: 'imageAltMatchesNearbyText', labelKey: 'a11yImageAltMatchesNearbyText' },
  { kind: 'imageAltIsUrl', labelKey: 'a11yImageAltIsUrl' },
  { kind: 'imageAltNoLetters', labelKey: 'a11yImageAltNoLetters' },
  { kind: 'headingNoLetters', labelKey: 'a11yHeadingNoLetters' },
  { kind: 'tableInconsistentColumns', labelKey: 'a11yTableInconsistentColumns' },
  { kind: 'linkTextNoLetters', labelKey: 'a11yLinkTextNoLetters' },
  { kind: 'headingTextIsUrl', labelKey: 'a11yHeadingTextIsUrl' },
  { kind: 'linkTextTooLong', labelKey: 'a11yLinkTextTooLong' },
  { kind: 'headingAllCaps', labelKey: 'a11yHeadingAllCaps' },
]

function issueLabel(t: (k: I18nKey) => string, issue: A11yIssue): string {
  switch (issue.kind) {
    case 'imageAltMissing':
      return `${t('a11yImage')} ${issue.imageIndex}`
    case 'imageAltTooLong':
      return `${t('a11yImage')} ${issue.imageIndex}`
    case 'tableNoHeader':
      return `${t('a11yTable')} ${issue.tableIndex}`
    case 'tableMergedCells':
      return `${t('a11yTable')} ${issue.tableIndex}`
    case 'tableEmptyCells':
      return `${t('a11yTable')} ${issue.tableIndex}`
    case 'tableHeaderNotFirstRow':
      return `${t('a11yTable')} ${issue.tableIndex}`
    case 'tableInconsistentColumns':
      return `${t('a11yTable')} ${issue.tableIndex}`
    case 'imageAltMatchesNearbyText':
      return issue.altText
        ? `${t('a11yImage')} ${issue.imageIndex}: ${issue.altText}`
        : `${t('a11yImage')} ${issue.imageIndex}`
    case 'imageAltIsUrl':
      return issue.altText
        ? `${t('a11yImage')} ${issue.imageIndex}: ${issue.altText}`
        : `${t('a11yImage')} ${issue.imageIndex}`
    case 'imageAltNoLetters':
      return issue.altText
        ? `${t('a11yImage')} ${issue.imageIndex}: ${issue.altText}`
        : `${t('a11yImage')} ${issue.imageIndex}`
    case 'headingSkip':
      return issue.headingText
        ? `H${issue.prevLevel} → H${issue.level}: ${issue.headingText}`
        : `H${issue.prevLevel} → H${issue.level}`
    case 'headingEmpty':
      return `${t('a11yHeading')} ${issue.headingIndex}`
    case 'linkEmptyText':
      return `${t('a11yLink')} ${issue.linkIndex}`
    case 'linkVagueText':
      return issue.linkText
        ? `${t('a11yLink')} ${issue.linkIndex}: ${issue.linkText}`
        : `${t('a11yLink')} ${issue.linkIndex}`
    case 'firstHeadingNotH1':
      return issue.headingText
        ? `H${issue.level}: ${issue.headingText}`
        : `H${issue.level}`
    case 'headingDuplicateText':
      return issue.headingText
        ? `H${issue.level}: ${issue.headingText}`
        : `H${issue.level}`
    case 'headingNoContent':
      return issue.headingText && issue.headingText.trim() !== ''
        ? `H${issue.level}: ${issue.headingText}`
        : `${t('a11yHeading')} ${issue.headingIndex}`
    case 'imageAltVague':
      return issue.altText
        ? `${t('a11yImage')} ${issue.imageIndex}: ${issue.altText}`
        : `${t('a11yImage')} ${issue.imageIndex}`
    case 'imageAltDuplicate':
      return issue.altText
        ? `${t('a11yImage')} ${issue.imageIndex}: ${issue.altText}`
        : `${t('a11yImage')} ${issue.imageIndex}`
    case 'imageAltIsFilename':
      return issue.altText
        ? `${t('a11yImage')} ${issue.imageIndex}: ${issue.altText}`
        : `${t('a11yImage')} ${issue.imageIndex}`
    case 'linkTextIsUrl':
      return issue.linkText
        ? `${t('a11yLink')} ${issue.linkIndex}: ${issue.linkText}`
        : `${t('a11yLink')} ${issue.linkIndex}`
    case 'linkSameTextDifferentTarget':
      return issue.linkText
        ? `${t('a11yLink')} ${issue.linkIndex}: ${issue.linkText}`
        : `${t('a11yLink')} ${issue.linkIndex}`
    case 'linkMissingHref':
      return issue.linkText
        ? `${t('a11yLink')} ${issue.linkIndex}: ${issue.linkText}`
        : `${t('a11yLink')} ${issue.linkIndex}`
    case 'linkSameTargetDifferentText':
      return issue.linkText
        ? `${t('a11yLink')} ${issue.linkIndex}: ${issue.linkText}`
        : `${t('a11yLink')} ${issue.linkIndex}`
    case 'headingTooLong':
      return issue.headingText && issue.headingText.trim() !== ''
        ? `H${issue.level}: ${issue.headingText}`
        : `${t('a11yHeading')} ${issue.headingIndex}`
    case 'headingNoLetters':
      return issue.headingText && issue.headingText.trim() !== ''
        ? `H${issue.level}: ${issue.headingText}`
        : `${t('a11yHeading')} ${issue.headingIndex}`
    case 'headingMultipleH1':
      return issue.headingText && issue.headingText.trim() !== ''
        ? `H${issue.level}: ${issue.headingText}`
        : `${t('a11yHeading')} ${issue.headingIndex}`
    case 'linkTextNoLetters':
      return issue.linkText
        ? `${t('a11yLink')} ${issue.linkIndex}: ${issue.linkText}`
        : `${t('a11yLink')} ${issue.linkIndex}`
    case 'headingTextIsUrl':
      return issue.headingText && issue.headingText.trim() !== ''
        ? `H${issue.level}: ${issue.headingText}`
        : `${t('a11yHeading')} ${issue.headingIndex}`
    case 'linkTextTooLong':
      return issue.linkText
        ? `${t('a11yLink')} ${issue.linkIndex}: ${issue.linkText}`
        : `${t('a11yLink')} ${issue.linkIndex}`
    case 'headingAllCaps':
      return issue.headingText && issue.headingText.trim() !== ''
        ? `H${issue.level}: ${issue.headingText}`
        : `${t('a11yHeading')} ${issue.headingIndex}`
    case 'imageAltRedundantPrefix':
      return issue.altText
        ? `${t('a11yImage')} ${issue.imageIndex}: ${issue.altText}`
        : `${t('a11yImage')} ${issue.imageIndex}`
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
