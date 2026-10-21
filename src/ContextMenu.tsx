import { Fragment, useEffect } from 'react'
import { Check } from 'lucide-react'
import { currentZoom } from './appearance'

export interface MenuItem {
  label: string
  danger?: boolean // red; put it last: it always gets the line above it
  divider?: boolean // a thin line above it (starts a new group of actions)
  swatch?: string // a small round color dot before the label (a CSS color)
  checked?: boolean // a ✓ after the label (the current choice)
  onClick: () => void
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

// Right-click menu (long press on a phone). Closes on any click elsewhere or Escape.
function ContextMenu({ x, y, items, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // x / y are screen pixels (mouse position): convert to the zoomed page (app scaling),
  // and keep the menu inside the window
  const zoom = currentZoom()
  const left = Math.min(x / zoom, window.innerWidth / zoom - 170)
  const top = Math.min(y / zoom, window.innerHeight / zoom - 20 - items.length * 34)

  return (
    <div
      className="menu-backdrop"
      onMouseDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div className="context-menu" style={{ left, top }} onMouseDown={(e) => e.stopPropagation()}>
        {items.map((item, index) => (
          <Fragment key={item.label}>
            {(item.divider || item.danger) && index > 0 && <div className="context-menu-divider" />}
            <button
              className={item.danger ? 'danger' : ''}
              onClick={() => {
                onClose()
                item.onClick()
              }}
            >
              {item.swatch && <span className="menu-swatch" style={{ background: item.swatch }} />}
              {item.label}
              {item.checked && <Check size={14} className="menu-check" />}
            </button>
          </Fragment>
        ))}
      </div>
    </div>
  )
}

export default ContextMenu
