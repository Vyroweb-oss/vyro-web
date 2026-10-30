import { useState } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { extractLiveHeadings, activeHeadingIndex } from '../lib/headings'
import { findDocMatches, selectMatch, jumpToPosition } from '../lib/findReplace'
import {
  sectionRange, levelSkipWarnings, planSectionMove, setHeadingLevel,
  selectSection, moveSection, toggleSectionCollapsed, isSectionCollapsed,
  hasNonHeadingBody,
} from '../lib/sections'
import { tr, type UiLang, type I18nKey } from '../lib/i18n'
import { usePanelFocusReturn } from './useDialogFocus'

// Navigation Pane (Mission 2, M2-02 = owner spec §3, extended by M2-11 =
// owner spec §4 Document Outline & section management): a live heading
// outline beside the page. It re-renders on every editor transaction (via
// useEditorState), so heading edits update it instantly. Clicking a heading
// jumps the cursor there; the heading containing (or nearest above) the
// cursor is highlighted. The pane's own search covers the WHOLE document
// (headings + body): Prev/Next cycle every match and select it in the editor.
//
// M2-11 additions, one row per heading:
// - Tree view: rows are indented by heading level (nesting by level order).
// - Level change: a per-row select (H1-H6 + Paragraph) rewrites the heading
//   node in one undoable transaction; autosave follows the normal onUpdate path.
// - Level-skip warnings: a heading jumping >1 deeper than its predecessor
//   (e.g. H1 -> H3) shows a ⚠ flag on its row; the count is shown above the
//   list. Warnings are reported only, never auto-fixed.
// - Select-whole-section: selects the heading + body + subsections, so the
//   user can copy/move it; the selection is visible in the editor.
// - Collapse/expand: hides the section's non-heading body blocks via a
//   ProseMirror decoration (document JSON untouched, session-only); the
//   subsection headings stay visible. Disabled when there is nothing hideable.
// - Section move: drag a row and drop it before/after another row (HTML5
//   drag, with a live drop indicator), or use the ↑ / ↓ / into buttons.
//   Every move carries the whole section (incl. subsections) as one block
//   in a single transaction = a single undo step; invalid moves (into
//   itself, no-ops, non-deeper "into") are rejected and change nothing.
//   "Into" is deliberately narrow: only into the previous heading, only
//   when that heading's section holds no other heading, and only when the
//   moved heading is deeper — so no other section's body text is re-parented.
export default function NavigationPane({ editor, lang, onCollapse }: {
  editor: Editor
  lang: UiLang
  onCollapse: () => void
}) {
  const t = (k: I18nKey) => tr(lang, k)
  // M2-15: Esc closes the pane (root handler below), focus returns to
  // the opener on collapse.
  usePanelFocusReturn()
  const [query, setQuery] = useState('')
  const [matchIdx, setMatchIdx] = useState(0)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<{ idx: number; where: 'before' | 'after' } | null>(null)
  // Collapse dispatches a meta-only transaction; bump local state as well
  // so the row's ▸/▾ icon refreshes even if a transaction listener skips it.
  const [, setCollapseTick] = useState(0)

  const state = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      if (!ed) return { headings: [], sel: 0 }
      return { headings: extractLiveHeadings(ed.state.doc), sel: ed.state.selection.from }
    },
  })
  const headings = state?.headings ?? []
  const activeIdx = activeHeadingIndex(headings, state?.sel ?? 0)
  const docEnd = editor.state.doc.content.size
  const warnings = levelSkipWarnings(headings)
  const warnByIndex = new Map(warnings.map((w) => [w.index, w]))

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

  const clearDrag = () => { setDragIdx(null); setDropTarget(null) }
  const onRowDragOver = (e: React.DragEvent, globalIdx: number) => {
    if (dragIdx === null || dragIdx === globalIdx) return
    e.preventDefault()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const where = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setDropTarget((prev) => (prev?.idx === globalIdx && prev.where === where ? prev : { idx: globalIdx, where }))
  }
  const onRowDrop = (e: React.DragEvent, globalIdx: number) => {
    e.preventDefault()
    if (dragIdx !== null && dropTarget) {
      moveSection(editor, headings, docEnd, dragIdx, globalIdx, dropTarget.where)
    }
    clearDrag()
  }

  return (
    <aside className="nav-pane" aria-label={t('navigationPane')}
      onKeyDown={(e) => { if (e.key === 'Escape') onCollapse() }}>
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
      {warnings.length > 0 && (
        <div className="nav-skip-count" role="status">
          ⚠ {warnings.length} {t('sectionSkipCount')}
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
            const collapsed = isSectionCollapsed(editor, headings, globalIdx, docEnd)
            const collapsible = hasNonHeadingBody(editor.state.doc, headings, globalIdx, docEnd)
            const range = sectionRange(headings, globalIdx, docEnd)
            const nextIdx = range ? range.lastHeadingIndex + 1 : -1
            const warn = warnByIndex.get(globalIdx)
            const dropCls = dropTarget?.idx === globalIdx
              ? (dropTarget.where === 'before' ? ' drop-before' : ' drop-after') : ''
            const intoOk = globalIdx > 0 &&
              planSectionMove(headings, docEnd, globalIdx, globalIdx - 1, 'child') !== null
            return (
              <li key={`${h.from}-${i}`}
                className={`nav-row${dropCls}`}
                draggable
                onDragStart={(e) => {
                  setDragIdx(globalIdx)
                  e.dataTransfer.effectAllowed = 'move'
                  try { e.dataTransfer.setData('text/plain', String(globalIdx)) } catch { /* drag data is best-effort */ }
                }}
                onDragOver={(e) => onRowDragOver(e, globalIdx)}
                onDrop={(e) => onRowDrop(e, globalIdx)}
                onDragEnd={clearDrag}
              >
                <div className="nav-row-main">
                  <button type="button" className="rbtn small nav-collapse-btn"
                    disabled={!collapsible}
                    title={collapsed ? t('sectionExpand') : t('sectionCollapse')}
                    aria-label={collapsed ? t('sectionExpand') : t('sectionCollapse')}
                    onClick={() => {
                      toggleSectionCollapsed(editor, headings, globalIdx, docEnd)
                      setCollapseTick((v) => v + 1)
                    }}>
                    {collapsed ? '▸' : '▾'}
                  </button>
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
                  {warn && (
                    <span className="nav-skip" role="img"
                      title={`${t('sectionSkipWarning')} (H${warn.prevLevel} → H${warn.level})`}>⚠</span>
                  )}
                  {/* M2-15: drag-only affordance, not a control — the row
                    itself is draggable and ↑/↓/↳ buttons already move it,
                    so this grip is decorative and hidden from AT/focus. */}
                  <span className="nav-drag-handle" title={t('sectionDragHandle')} aria-hidden="true">⋮⋮</span>
                </div>
                <div className="nav-row-controls">
                  <select
                    aria-label={t('sectionLevel')}
                    value={String(h.level)}
                    onChange={(e) => {
                      const v = e.target.value
                      setHeadingLevel(editor, h, v === 'p' ? null : Number(v))
                    }}
                  >
                    {[1, 2, 3, 4, 5, 6].map((lv) => (
                      <option key={lv} value={lv}>H{lv}</option>
                    ))}
                    <option value="p">{t('paragraph')}</option>
                  </select>
                  <button type="button" className="rbtn small"
                    title={t('sectionSelect')}
                    onClick={() => {
                      if (selectSection(editor, headings, globalIdx, docEnd)) {
                        try { editor.commands.focus() } catch { /* focus is best-effort */ }
                      }
                    }}>
                    {t('sectionSelect')}
                  </button>
                  <button type="button" className="rbtn small"
                    disabled={globalIdx === 0}
                    title={t('sectionMoveUp')}
                    aria-label={t('sectionMoveUp')}
                    onClick={() => moveSection(editor, headings, docEnd, globalIdx, globalIdx - 1, 'before')}>↑</button>
                  <button type="button" className="rbtn small"
                    disabled={nextIdx < 0 || nextIdx >= headings.length}
                    title={t('sectionMoveDown')}
                    aria-label={t('sectionMoveDown')}
                    onClick={() => {
                      // Parent fix (M2-11 verification): moving "before" the
                      // next heading is a no-op — the section already sits
                      // there, and planSectionMove rightly rejects it. Move
                      // AFTER the whole next section instead, so ↓ swaps
                      // with the next section (incl. its subsections).
                      const r = sectionRange(headings, globalIdx, docEnd)
                      if (r && r.lastHeadingIndex + 1 < headings.length) {
                        moveSection(editor, headings, docEnd, globalIdx, r.lastHeadingIndex + 1, 'after')
                      }
                    }}>↓</button>
                  <button type="button" className="rbtn small"
                    disabled={!intoOk}
                    title={t('sectionMoveInto')}
                    aria-label={t('sectionMoveInto')}
                    onClick={() => moveSection(editor, headings, docEnd, globalIdx, globalIdx - 1, 'child')}>↳</button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
