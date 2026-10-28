import { Fragment, useEffect } from 'react'
import { Check, type LucideIcon } from 'lucide-react'
import { currentZoom } from './appearance'

export interface MenuItem {
  label: string
  icon?: LucideIcon // before the label
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
  header?: { title: string; subtitle?: string } // what was right-clicked (e.g. a mail), above a line
  onClose: () => void
}

// Right-click menu (long press on a phone). Closes on any click elsewhere or Escape.
function ContextMenu({ x, y, items, header, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // x / y are screen pixels (mouse position): convert to the zoomed page (app scaling),
  // and keep the menu inside the window
  const zoom = currentZoom()
  const left = Math.min(x / zoom, window.innerWidth / zoom - 170)
  const top = Math.min(y / zoom, window.innerHeight / zoom - 20 - items.length * 36 - (header ? 52 : 0))

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
        {header && (
          <>
            <div className="context-menu-header">
              <span className="context-menu-title" title={header.title}>{header.title}</span>
              {header.subtitle && <span className="context-menu-subtitle" title={header.subtitle}>{header.subtitle}</span>}
            </div>
            <div className="context-menu-divider" />
          </>
        )}
        {items.map((item, index) => (
          // Labels can repeat (two Board groups with the same name): the place makes it unique
          <Fragment key={`${index}:${item.label}`}>
            {(item.divider || item.danger) && index > 0 && <div className="context-menu-divider" />}
            <button
              className={item.danger ? 'danger' : ''}
              onClick={() => {
                onClose()
                item.onClick()
              }}
            >
              {item.icon && <item.icon size={15} className="menu-icon" />}
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
