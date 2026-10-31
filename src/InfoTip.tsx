import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'
import { currentZoom } from './appearance'

const GAP = 6 // px between the ⓘ and its box
const MARGIN = 8 // px kept from the screen's edges

// A small ⓘ after a label that explains it in a box: opens on hover with a mouse, or on a
// click / tap (phone); closes when the mouse leaves, or on a click / tap anywhere else. The box
// looks like a menu (.context-menu) and unfolds like one. It's drawn over the whole app (not
// inside its window, which would cut it off), below the ⓘ, or above it when there's no room.
export default function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const boxRef = useRef<HTMLSpanElement>(null)
  const pointer = useRef('')
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  // Placed from screen pixels, so divided by the app scale (CSS zoom)
  useLayoutEffect(() => {
    const box = boxRef.current
    const button = ref.current?.firstElementChild
    if (!open || !box || !button) return
    const zoom = currentZoom()
    const at = button.getBoundingClientRect()
    const size = box.getBoundingClientRect()
    const screenW = window.innerWidth / zoom
    const screenH = window.innerHeight / zoom
    const below = at.bottom / zoom + GAP
    const above = at.top / zoom - GAP - size.height / zoom
    const top = below + size.height / zoom <= screenH - MARGIN || above < MARGIN ? below : above
    const left = Math.max(MARGIN, Math.min(at.left / zoom - MARGIN, screenW - MARGIN - size.width / zoom))
    box.style.top = `${top}px`
    box.style.left = `${left}px`
    box.classList.toggle('above', top !== below)
    box.style.visibility = ''
  }, [open])
  return (
    <span
      ref={ref}
      className="info-tip"
      onPointerEnter={(e) => e.pointerType === 'mouse' && setOpen(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setOpen(false)}
    >
      {/* A mouse click doesn't close what hovering opened; a tap or the keyboard switches it */}
      <button
        type="button"
        className="info-tip-button"
        aria-label={label}
        aria-expanded={open}
        onPointerDown={(e) => (pointer.current = e.pointerType)}
        onClick={(e) => (e.detail === 0 || pointer.current !== 'mouse' ? setOpen((o) => !o) : setOpen(true))}
      >
        <Info size={14} />
      </button>
      {open &&
        createPortal(
          <span ref={boxRef} className="info-tip-box" role="tooltip" style={{ visibility: 'hidden' }}>
            {children}
          </span>,
          document.body,
        )}
    </span>
  )
}
