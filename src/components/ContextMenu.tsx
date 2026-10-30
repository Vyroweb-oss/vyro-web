import { useEffect, useRef, useState } from 'react'
import { tr, type UiLang, type I18nKey } from '../lib/i18n'
import type { MenuItemId } from '../lib/paste'
import { clampMenuPosition } from '../lib/paste'

const LABEL: Record<MenuItemId, I18nKey> = {
  cut: 'menuCut', copy: 'menuCopy', pastePlain: 'menuPastePlain',
  clearFormatting: 'clearFormatting', bold: 'menuBold', italic: 'menuItalic', link: 'link',
  addRow: 'addRow', addColumn: 'addColumn', deleteRow: 'menuDeleteRow', deleteColumn: 'menuDeleteColumn',
  imageAlt: 'menuImageAlt', alignLeft: 'alignLeft', alignCenter: 'alignCenter', alignRight: 'alignRight',
  deleteImage: 'menuDeleteImage', editLink: 'menuEditLink', removeLink: 'removeLink', openLink: 'menuOpenLink',
}

/** Groups separated visually: text, table, image, link. */
const GROUP_OF: Record<MenuItemId, number> = {
  cut: 0, copy: 0, pastePlain: 0, clearFormatting: 0, bold: 0, italic: 0, link: 0,
  addRow: 1, addColumn: 1, deleteRow: 1, deleteColumn: 1,
  imageAlt: 2, alignLeft: 2, alignCenter: 2, alignRight: 2, deleteImage: 2,
  editLink: 3, removeLink: 3, openLink: 3,
}

export default function ContextMenu({ items, x, y, lang, onAction, onClose }: {
  items: MenuItemId[]; x: number; y: number; lang: UiLang
  onAction: (id: MenuItemId) => void; onClose: () => void
}) {
  const t = (k: I18nKey) => tr(lang, k)
  const ref = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [pos, setPos] = useState({ x, y })
  // Measure once mounted and clamp against the real menu size, so the
  // menu is never off-screen even on narrow phones.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setPos(clampMenuPosition(x, y, el.offsetWidth, el.offsetHeight, window.innerWidth, window.innerHeight))
    itemRefs.current[0]?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const move = (dir: 1 | -1) => {
    const cur = itemRefs.current.findIndex((el) => el === document.activeElement)
    const next = cur < 0 ? 0 : (cur + dir + items.length) % items.length
    itemRefs.current[next]?.focus()
  }
  return (
    <>
      <div className="ctx-backdrop" onMouseDown={onClose} onTouchStart={onClose} />
      <div
        ref={ref} className="ctx-menu" role="menu" aria-label={t('menuContext')}
        style={{ left: pos.x, top: pos.y }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); onClose() }
          else if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
        }}
      >
        {items.map((id, i) => (
          <span key={id} className="ctx-group-wrap">
            {i > 0 && GROUP_OF[items[i - 1]] !== GROUP_OF[id] && <span className="ctx-sep" aria-hidden="true" />}
            <button
              type="button" role="menuitem" ref={(el) => { itemRefs.current[i] = el }}
              className={id === 'deleteImage' || id === 'deleteRow' || id === 'deleteColumn' ? 'danger' : ''}
              onClick={() => onAction(id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAction(id) } }}
            >{t(LABEL[id])}</button>
          </span>
        ))}
      </div>
    </>
  )
}
