import { useState } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { extractLiveHeadings, activeHeadingIndex } from '../lib/headings'
import { findDocMatches, selectMatch, jumpToPosition } from '../lib/findReplace'
import { tr, type UiLang, type I18nKey } from '../lib/i18n'

// Navigation Pane (Mission 2, M2-02 = owner spec §3): a live heading outline
// beside the page. It re-renders on every editor transaction (via
// useEditorState), so heading edits update it instantly. Clicking a heading
// jumps the cursor there; the heading containing (or nearest above) the
// cursor is highlighted. The pane's own search covers the WHOLE document
// (headings + body): Prev/Next cycle every match and select it in the editor.
export default function NavigationPane({ editor, lang, onCollapse }: {
  editor: Editor
  lang: UiLang
  onCollapse: () => void
}) {
  const t = (k: I18nKey) => tr(lang, k)
  const [query, setQuery] = useState('')
  const [matchIdx, setMatchIdx] = useState(0)

  const state = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      if (!ed) return { headings: [], sel: 0 }
      return { headings: extractLiveHeadings(ed.state.doc), sel: ed.state.selection.from }
    },
  })
  const headings = state?.headings ?? []
  const activeIdx = activeHeadingIndex(headings, state?.sel ?? 0)

  const matches = query ? findDocMatches(editor.state.doc, query) : []
  const cur = matches.length ? Math.min(matchIdx, matches.length - 1) : -1
  const goMatch = (idx: number) => {
    if (!matches.length) return
    const next = (idx + matches.length) % matches.length
    setMatchIdx(next)
    selectMatch(editor, matches[next])
  }
  // While searching, the outline narrows to headings containing the query;
  // match navigation itself still covers the whole document (see above).
  const shown = query
    ? headings.filter((h) => h.text.toLowerCase().includes(query.toLowerCase()))
    : headings

  return (
    <aside className="nav-pane" aria-label={t('navigationPane')}>
      <div className="nav-pane-head">
        <span className="nav-pane-title">{t('navigationPane')}</span>
        <button type="button" className="rbtn nav-collapse" onClick={onCollapse}
          title={t('navigationCollapse')} aria-label={t('navigationCollapse')}>«</button>
      </div>
      <div className="nav-search-row">
        <input
          value={query}
          dir="auto"
          onChange={(e) => { setQuery(e.target.value); setMatchIdx(0) }}
          placeholder={t('navigationSearchPlaceholder')}
          aria-label={t('navigationSearchPlaceholder')}
        />
      </div>
      {query && (
        <div className="nav-match-row" role="status">
          <span>{matches.length} {t('matches')}</span>
          <button type="button" className="rbtn small" disabled={!matches.length}
            onClick={() => goMatch(cur - 1)}>{t('findPrev')}</button>
          <button type="button" className="rbtn small" disabled={!matches.length}
            onClick={() => goMatch(cur + 1)}>{t('findNext')}</button>
        </div>
      )}
      {headings.length === 0 ? (
        <p className="nav-empty">{t('navigationEmpty')}</p>
      ) : shown.length === 0 ? (
        <p className="nav-empty">{t('noMatchesFound')}</p>
      ) : (
        <ul className="nav-list">
          {shown.map((h, i) => {
            const globalIdx = headings.indexOf(h)
            return (
              <li key={`${h.from}-${i}`}>
                <button
                  type="button"
                  className={`nav-item${globalIdx === activeIdx ? ' active' : ''}`}
                  style={{ paddingInlineStart: `${(h.level - 1) * 16 + 10}px` }}
                  onClick={() => jumpToPosition(editor, h.contentPos)}
                  title={h.text || t('navigationEmptyHeading')}
                >
                  <span className="nav-item-text">{h.text}</span>
                  {h.empty && <span className="nav-empty-flag">{t('navigationEmptyHeading')}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
