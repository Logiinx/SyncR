import { useEffect } from 'react'

export interface MenuItem {
  label: string
  danger?: boolean
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

  // Keep the menu inside the window
  const left = Math.min(x, window.innerWidth - 170)
  const top = Math.min(y, window.innerHeight - 20 - items.length * 34)

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
        {items.map((item) => (
          <button
            key={item.label}
            className={item.danger ? 'danger' : ''}
            onClick={() => {
              onClose()
              item.onClick()
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default ContextMenu
