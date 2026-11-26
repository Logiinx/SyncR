import { useEffect, useLayoutEffect, useRef } from 'react'
import { t } from './i18n'
import type { Editor } from '@tiptap/react'
import {
  Ban,
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  PanelTop,
  Trash2,
} from 'lucide-react'
import { currentZoom } from './appearance'
import { COLORS } from './cardColors'
import { highlightColor } from './ColorPicker'
import { useBack } from './backStack'

interface Props {
  editor: Editor
  x: number
  y: number
  onClose: () => void
}

const EDGE = 8 // px kept free between the menu and the window's edge (like ContextMenu)

// Right-click (long press on a phone) in a table: rows, columns, header row, cell color.
// Works on the cell under the mouse, or on all selected cells. Escape or Back (backStack.ts) closes it.
function TableMenu({ editor, x, y, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useBack(onClose)

  const chain = () => editor.chain().focus()
  const run = (action: () => void) => () => {
    onClose()
    action()
  }
  const hasHeader = headerRowExists(editor)
  const cellColor = editor.getAttributes(editor.isActive('tableHeader') ? 'tableHeader' : 'tableCell').backgroundColor

  // Screen pixels (mouse position) → zoomed page, kept inside the window from its real size (like ContextMenu)
  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const zoom = currentZoom()
    el.style.left = el.style.top = '0'
    const { width, height } = el.getBoundingClientRect()
    el.style.left = `${Math.max(EDGE, Math.min(x, window.innerWidth - width - EDGE)) / zoom}px`
    el.style.top = `${Math.max(EDGE, Math.min(y, window.innerHeight - height - EDGE)) / zoom}px`
  }, [x, y])

  return (
    <div
      className="menu-backdrop"
      onMouseDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div ref={box} className="context-menu table-menu" onMouseDown={(e) => e.stopPropagation()}>
        <button onClick={run(() => chain().addRowBefore().run())}><BetweenHorizontalStart size={15} className="menu-icon" />{t('Add row above')}</button>
        <button onClick={run(() => chain().addRowAfter().run())}><BetweenHorizontalEnd size={15} className="menu-icon" />{t('Add row below')}</button>
        <button onClick={run(() => chain().addColumnBefore().run())}><BetweenVerticalStart size={15} className="menu-icon" />{t('Add column left')}</button>
        <button onClick={run(() => chain().addColumnAfter().run())}><BetweenVerticalEnd size={15} className="menu-icon" />{t('Add column right')}</button>
        <div className="context-menu-divider" />
        <button onClick={run(() => chain().deleteRow().run())}><Trash2 size={15} className="menu-icon" />{t('Delete row')}</button>
        <button onClick={run(() => chain().deleteColumn().run())}><Trash2 size={15} className="menu-icon" />{t('Delete column')}</button>
        <div className="context-menu-divider" />
        <button onClick={run(() => chain().toggleHeaderRow().run())}>
          <PanelTop size={15} className="menu-icon" />
          {hasHeader ? t('Remove header row') : t('Make first row a header')}
        </button>
        <div className="context-menu-section">{t('Cell color')}</div>
        <div className="color-picker">
          <div className="color-row">
            <button
              className={!cellColor ? 'swatch selected' : 'swatch'}
              title={t('No color')}
              aria-label={t('No color')}
              onClick={run(() => chain().setCellAttribute('backgroundColor', null).run())}
            >
              <Ban size={14} />
            </button>
            {COLORS.map(({ id, name }) => (
              <button
                key={id}
                className={cellColor === highlightColor(id) ? 'swatch selected' : 'swatch'}
                title={t(name)}
                aria-label={t(name)}
                onClick={run(() => chain().setCellAttribute('backgroundColor', highlightColor(id)).run())}
              >
                <span className="highlight-swatch" style={{ background: highlightColor(id) }} />
              </button>
            ))}
          </div>
        </div>
        <div className="context-menu-divider" />
        <button className="danger" onClick={run(() => chain().deleteTable().run())}>
          <Trash2 size={15} className="menu-icon" />
          {t('Delete table')}
        </button>
      </div>
    </div>
  )
}

// Is the table's first row a header row? (The cursor may be in a normal cell.)
function headerRowExists(editor: Editor) {
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (node.type.name === 'table') return node.firstChild?.firstChild?.type.name === 'tableHeader'
  }
  return false
}

export default TableMenu
