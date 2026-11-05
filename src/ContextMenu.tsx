import { Fragment, useEffect, useLayoutEffect, useRef } from 'react'
import { Check, type LucideIcon } from 'lucide-react'
import { currentZoom } from './appearance'

export interface MenuItem {
  label: string
  icon?: LucideIcon // before the label
  danger?: boolean // red; put it last: it always gets the line above it
  divider?: boolean // a thin line above it (starts a new group of actions)
  swatch?: string // a small round color dot before the label (a CSS color)
  checked?: boolean // a ✓ after the label (the current choice)
  disabled?: boolean // grayed, can't be pressed
  hint?: string // tooltip
  keepFocus?: boolean // pressing it leaves the cursor where it is (e.g. in the text being edited)
  onClick: () => void
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  header?: { title: string; subtitle?: string } // what was right-clicked (e.g. a mail), above a line
  onClose: () => void
}

const EDGE = 8 // px kept free between the menu and the window's edge

// Right-click menu (long press on a phone). Closes on any click elsewhere or Escape.
function ContextMenu({ x, y, items, header, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // x / y are screen pixels (mouse position): keep the menu inside the window, from its real size
  // (again when it changes, e.g. to a color list), and convert to the zoomed page (app scaling)
  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const zoom = currentZoom()
    el.style.left = el.style.top = '0'
    const { width, height } = el.getBoundingClientRect()
    el.style.left = `${Math.max(EDGE, Math.min(x, window.innerWidth - width - EDGE)) / zoom}px`
    el.style.top = `${Math.max(EDGE, Math.min(y, window.innerHeight - height - EDGE)) / zoom}px`
  })

  return (
    <div
      className="menu-backdrop"
      onMouseDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div className="context-menu" ref={box} onMouseDown={(e) => e.stopPropagation()}>
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
              disabled={item.disabled}
              title={item.hint}
              onMouseDown={item.keepFocus ? (e) => e.preventDefault() : undefined}
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
