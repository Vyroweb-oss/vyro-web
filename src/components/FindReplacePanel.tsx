import { useRef, useState } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import {
  findDocMatches, blockOfMatch, previewSnippet,
  selectMatch, replaceMatch, replaceAllMatches,
} from '../lib/findReplace'
import { tr, type UiLang, type I18nKey } from '../lib/i18n'

// Advanced Find & Replace (Mission 2, M2-02 = owner spec §5). Opened from a
// toolbar button only — Ctrl+F is deliberately NOT bound, so the browser's
// own find keeps working.
//
// Selection-scope safety: the selection that existed when the panel OPENED
// is snapshotted. If it was non-collapsed, Replace-all applies ONLY inside
// that snapshot (the panel says so, and the button shows the in-scope
// count); navigation and Replace-one are unaffected. The user can clear the
// scope to search the whole document. Navigation never silently changes the
// scope, because navigating selects matches in the editor.
export default function FindReplacePanel({ editor, lang, onClose, onBeforeReplaceAll }: {
  editor: Editor
  lang: UiLang
  onClose: () => void
  /** M2-04: called BEFORE the bulk replacement runs, so the caller can snapshot the pre-replace document. */
  onBeforeReplaceAll?: () => void
}) {
  const t = (k: I18nKey) => tr(lang, k)
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [matchIdx, setMatchIdx] = useState(0)
  const scopeRef = useRef<{ from: number; to: number } | null>(null)
  if (scopeRef.current === null) {
    const sel = editor.state.selection
    scopeRef.current = sel.empty ? null : { from: sel.from, to: sel.to }
  }
  const [scoped, setScoped] = useState(scopeRef.current !== null)

  // Re-render on every editor transaction so counts/previews stay live
  // (the doc object identity changes with each transaction).
  useEditorState({ editor, selector: ({ editor: ed }) => ({ doc: ed?.state.doc }) })

  const opts = { caseSensitive, wholeWord }
  const allMatches = query ? findDocMatches(editor.state.doc, query, opts) : []
  const scope = scoped ? scopeRef.current : null
  const matches = scope
    ? allMatches.filter((m) => m.from >= scope.from && m.to <= scope.to)
    : allMatches
  const cur = matches.length ? Math.min(matchIdx, matches.length - 1) : -1

  const goMatch = (idx: number) => {
    if (!matches.length) return
    const next = (idx + matches.length) % matches.length
    setMatchIdx(next)
    selectMatch(editor, matches[next])
  }
  const doReplaceOne = () => {
    if (cur === -1) return
    replaceMatch(editor, matches[cur], replacement)
    setMatchIdx(cur) // clamped on next render; the next match slides into place
  }
  const doReplaceAll = () => {
    if (!matches.length) return
    onBeforeReplaceAll?.()
    replaceAllMatches(editor, matches, replacement)
    setMatchIdx(0)
  }

  // Preview: the current match for Replace-one, the first in-scope match
  // for Replace-all. Shown BEFORE confirming either action.
  const previewMatch = cur !== -1 ? matches[cur] : null
  const previewCtx = previewMatch ? blockOfMatch(editor.state.doc, previewMatch) : null
  const preview = previewCtx
    ? previewSnippet(previewCtx.blockText, previewCtx.inBlock, replacement)
    : null

  return (
    <div className="find-panel" role="region" aria-label={t('findReplace')}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
      <div className="find-row">
        <input
          autoFocus
          value={query}
          dir="auto"
          onChange={(e) => { setQuery(e.target.value); setMatchIdx(0) }}
          placeholder={t('findPlaceholder')}
          aria-label={t('findPlaceholder')}
        />
        <input
          value={replacement}
          dir="auto"
          onChange={(e) => setReplacement(e.target.value)}
          placeholder={t('replacePlaceholder')}
          aria-label={t('replacePlaceholder')}
        />
        <button type="button" className="rbtn" disabled={cur === -1} onClick={doReplaceOne}>{t('replaceOne')}</button>
        <button type="button" className="rbtn" disabled={!matches.length} onClick={doReplaceAll}>
          {t('replaceAll')}{scope ? ` (${matches.length})` : ''}
        </button>
        <button type="button" className="rbtn" onClick={onClose} aria-label={t('close')}>×</button>
      </div>
      <div className="find-row find-meta">
        <span role="status">
          {query
            ? (matches.length
              ? (cur !== -1 ? `${cur + 1} / ${matches.length} ${t('matches')}` : `${matches.length} ${t('matches')}`)
              : t('noMatchesFound'))
            : t('findReplace')}
        </span>
        <button type="button" className="rbtn small" disabled={!matches.length} onClick={() => goMatch(cur - 1)}>{t('findPrev')}</button>
        <button type="button" className="rbtn small" disabled={!matches.length} onClick={() => goMatch(cur + 1)}>{t('findNext')}</button>
        <label className="find-check"><input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} /> {t('caseSensitive')}</label>
        <label className="find-check"><input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} /> {t('wholeWord')}</label>
        {scope && (
          <span className="find-scope">
            {t('replaceScopeSelection')}
            <button type="button" className="rbtn small" onClick={() => setScoped(false)}>{t('replaceScopeWhole')}</button>
          </span>
        )}
      </div>
      {preview !== null && (
        <div className="find-preview" role="status">
          <span className="find-preview-label">{t('replacePreview')}:</span> {preview}
        </div>
      )}
    </div>
  )
}
