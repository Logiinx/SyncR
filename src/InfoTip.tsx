import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'
import { currentZoom } from './appearance'

const GAP = 6 // px between the ⓘ and its box
const MARGIN = 8 // px kept from the screen's edges
const HOVER_DELAY = 350 // ms over a HoverTip before its box opens (the mouse just passing doesn't)

// The box of an InfoTip or a HoverTip: looks like a menu (.context-menu) and unfolds like one.
// It's drawn over the whole app (not inside its window, which would cut it off), below `at`, or
// above it when there's no room. Placed from screen pixels, so divided by the app scale (CSS zoom).
function TipBox({ at, children }: { at: RefObject<Element | null>; children: ReactNode }) {
  const boxRef = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const box = boxRef.current
    const anchor = at.current
    if (!box || !anchor) return
    const zoom = currentZoom()
    const near = anchor.getBoundingClientRect()
    const size = box.getBoundingClientRect()
    const screenW = window.innerWidth / zoom
    const screenH = window.innerHeight / zoom
    const below = near.bottom / zoom + GAP
    const above = near.top / zoom - GAP - size.height / zoom
    const top = below + size.height / zoom <= screenH - MARGIN || above < MARGIN ? below : above
    const left = Math.max(MARGIN, Math.min(near.left / zoom - MARGIN, screenW - MARGIN - size.width / zoom))
    box.style.top = `${top}px`
    box.style.left = `${left}px`
    box.classList.toggle('above', top !== below)
    box.style.visibility = ''
  })
  return createPortal(
    <span ref={boxRef} className="info-tip-box" role="tooltip" style={{ visibility: 'hidden' }}>
      {children}
    </span>,
    document.body,
  )
}

// A small ⓘ after a label that explains it in a box: opens on hover with a mouse, or on a
// click / tap (phone); closes when the mouse leaves, or on a click / tap anywhere else.
export default function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const pointer = useRef('')
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
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
        ref={button}
        type="button"
        className="info-tip-button"
        aria-label={label}
        aria-expanded={open}
        onPointerDown={(e) => (pointer.current = e.pointerType)}
        onClick={(e) => (e.detail === 0 || pointer.current !== 'mouse' ? setOpen((o) => !o) : setOpen(true))}
      >
        <Info size={14} />
      </button>
      {open && <TipBox at={button}>{children}</TipBox>}
    </span>
  )
}

// The same box over something else (e.g. a Steam price in the Games lists), with a mouse only:
// opens after a short hover, closes when the mouse leaves. tip is only made while it's open, so
// what it shows can be asked for then.
export function HoverTip({ tip, className, children }: { tip: () => ReactNode; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <span
      ref={ref}
      className={className}
      title="" // no browser tooltip from around it (e.g. a tile's game name) over its box
      onPointerEnter={(e) => {
        if (e.pointerType !== 'mouse') return
        clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setOpen(true), HOVER_DELAY)
      }}
      onPointerLeave={() => {
        clearTimeout(timer.current)
        setOpen(false)
      }}
    >
      {children}
      {open && <TipBox at={ref}>{tip()}</TipBox>}
    </span>
  )
}
