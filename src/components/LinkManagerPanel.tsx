import { useEditorState, type Editor } from '@tiptap/react'
import { isSafeLinkUrl } from '../lib/docx'
import { tr, type UiLang, type I18nKey } from '../lib/i18n'

// Link Manager panel (Mission 2, M2-07 = owner spec §14). Follows the
// StatsPanel pattern: useEditorState re-renders on every transaction, so
// the list stays live with no polling and no stored state. Positions come
// from the live document (not from doc JSON), so click-to-jump, edit and
// remove all act on the exact link range. Validity reuses isSafeLinkUrl.
export interface PanelLink { from: number; to: number; text: string; href: string; valid: boolean }

export default function LinkManagerPanel({ editor, lang, onClose, onEditLink }: {
  editor: Editor; lang: UiLang; onClose: () => void
  onEditLink: (from: number, to: number) => void
}) {
  const t = (k: I18nKey) => tr(lang, k)
  const state = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      if (!ed) return { links: [] as PanelLink[] }
      const links: PanelLink[] = []
      ed.state.doc.descendants((node: any, pos: number) => {
        if (node.type.name !== 'text') return true
        for (const mark of node.marks || []) {
          if (mark.type.name === 'link' && typeof mark.attrs?.href === 'string') {
            links.push({ from: pos, to: pos + node.nodeSize, text: node.text || '', href: mark.attrs.href, valid: isSafeLinkUrl(mark.attrs.href) })
          }
        }
        return true
      })
      return { links }
    },
  })
  const links = state?.links ?? []
  const jump = (l: PanelLink) => { editor.chain().focus().setTextSelection({ from: l.from, to: l.to }).run() }
  const remove = (l: PanelLink) => { editor.chain().focus().setTextSelection({ from: l.from, to: l.to }).unsetLink().run() }

  return <div className="stats-panel" role="region" aria-label={t('linkManager')}>
    <div className="find-row">
      <span className="find-preview-label">{t('linkManager')}</span>
      <button type="button" className="rbtn" onClick={onClose} aria-label={t('close')}>×</button>
    </div>
    {links.length === 0
      ? <p className="muted">{t('linkManagerEmpty')}</p>
      : <ul className="version-list">
          {links.map((l, i) => <li key={`${l.from}-${l.to}-${i}`}>
            <div className="version-item" style={{ cursor: 'default' }}>
              <button type="button" className="rbtn small" onClick={() => jump(l)} title={l.href} style={{ alignSelf: 'stretch', justifyContent: 'flex-start' }}>
                <span dir="auto" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.text || l.href}</span>
              </button>
              <span className="version-meta" dir="ltr" style={{ overflowWrap: 'anywhere' }}>{l.href} · {l.valid ? t('linkValidFlag') : t('linkInvalidFlag')}</span>
              <div className="row wrap">
                <button type="button" className="primary small" onClick={() => onEditLink(l.from, l.to)}>{t('linkEditText')}</button>
                <button type="button" className="rbtn small" onClick={() => remove(l)}>{t('removeLink')}</button>
              </div>
            </div>
          </li>)}
        </ul>}
  </div>
}
