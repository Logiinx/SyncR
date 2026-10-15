import { useEffect } from 'react'
import type { Editor } from '@tiptap/react'
import { Ban } from 'lucide-react'
import { currentZoom } from './appearance'
import { COLORS, highlightColor } from './ColorPicker'

interface Props {
  editor: Editor
  x: number
  y: number
  onClose: () => void
}

const MENU_WIDTH = 230
const MENU_HEIGHT = 390 // roughly, to keep it inside the window

// Right-click (long press on a phone) in a table: rows, columns, header row, cell color.
// Works on the cell under the mouse, or on all selected cells.
function TableMenu({ editor, x, y, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const chain = () => editor.chain().focus()
  const run = (action: () => void) => () => {
    onClose()
    action()
  }
  const hasHeader = headerRowExists(editor)
  const cellColor = editor.getAttributes(editor.isActive('tableHeader') ? 'tableHeader' : 'tableCell').backgroundColor

  // Screen pixels (mouse position) → zoomed page, kept inside the window
  const zoom = currentZoom()
  const left = Math.max(4, Math.min(x / zoom, window.innerWidth / zoom - MENU_WIDTH - 4))
  const top = Math.max(4, Math.min(y / zoom, window.innerHeight / zoom - MENU_HEIGHT))

  return (
    <div
      className="menu-backdrop"
      onMouseDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div className="context-menu table-menu" style={{ left, top }} onMouseDown={(e) => e.stopPropagation()}>
        <button onClick={run(() => chain().addRowBefore().run())}>Add row above</button>
        <button onClick={run(() => chain().addRowAfter().run())}>Add row below</button>
        <button onClick={run(() => chain().addColumnBefore().run())}>Add column left</button>
        <button onClick={run(() => chain().addColumnAfter().run())}>Add column right</button>
        <div className="menu-separator" />
        <button onClick={run(() => chain().deleteRow().run())}>Delete row</button>
        <button onClick={run(() => chain().deleteColumn().run())}>Delete column</button>
        <div className="menu-separator" />
        <button onClick={run(() => chain().toggleHeaderRow().run())}>
          {hasHeader ? 'Remove header row' : 'Make first row a header'}
        </button>
        <div className="menu-label">Cell color</div>
        <div className="color-picker">
          <div className="color-row">
            <button
              className={!cellColor ? 'swatch selected' : 'swatch'}
              title="No color"
              aria-label="No color"
              onClick={run(() => chain().setCellAttribute('backgroundColor', null).run())}
            >
              <Ban size={14} />
            </button>
            {COLORS.map(({ id, name }) => (
              <button
                key={id}
                className={cellColor === highlightColor(id) ? 'swatch selected' : 'swatch'}
                title={name}
                aria-label={name}
                onClick={run(() => chain().setCellAttribute('backgroundColor', highlightColor(id)).run())}
              >
                <span className="highlight-swatch" style={{ background: highlightColor(id) }} />
              </button>
            ))}
          </div>
        </div>
        <div className="menu-separator" />
        <button className="danger" onClick={run(() => chain().deleteTable().run())}>
          Delete table
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
