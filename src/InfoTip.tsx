import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'
import { currentZoom } from './appearance'

const GAP = 6 // px between the ⓘ and its box
const MARGIN = 8 // px kept from the screen's edges
const HOVER_DELAY = 350 // ms over a HoverTip before its box opens (the mouse just passing doesn't)

// The box of an InfoTip or a HoverTip: looks like a menu (.context-menu) and unfolds like one.
// It's drawn over the whole app (not inside its window, which would cut it off), below `at`, or
// above it when there's no room. Placed from screen pixels, so divided by the app scale (CSS zoom).
export function TipBox({ at, className, children }: { at: RefObject<Element | null>; className?: string; children: ReactNode }) {
  const boxRef = useRef<HTMLSpanElement>(null)
  // Placed again when its content changes size (e.g. a video card's numbers arriving)
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const sizes = new ResizeObserver(() => place(box, at.current))
    sizes.observe(box)
    return () => sizes.disconnect()
  }, [at])
  useLayoutEffect(() => place(boxRef.current, at.current))
  return createPortal(
    <span ref={boxRef} className={`info-tip-box${className ? ` ${className}` : ''}`} role="tooltip" style={{ visibility: 'hidden' }}>
      {children}
    </span>,
    document.body,
  )
}

// Below its anchor, or above when there's no room (see TipBox)
function place(box: HTMLElement | null, anchor: Element | null) {
  if (!box || !anchor) return
  const zoom = currentZoom()
  const near = anchor.getBoundingClientRect()
  const size = box.getBoundingClientRect()
  const screenW = window.innerWidth / zoom
  const screenH = window.innerHeight / zoom
  const below = near.bottom / zoom + GAP
  const above = near.top / zoom - GAP - size.height / zoom
  const height = size.height / zoom
  // Fitting neither way (a big box, a small window): the side with more room, kept on screen
  const downwards = below + height <= screenH - MARGIN || (above < MARGIN && screenH - near.bottom / zoom >= near.top / zoom)
  const top = Math.max(MARGIN, Math.min(downwards ? below : above, screenH - MARGIN - height))
  const left = Math.max(MARGIN, Math.min(near.left / zoom - MARGIN, screenW - MARGIN - size.width / zoom))
  box.style.top = `${top}px`
  box.style.left = `${left}px`
  box.classList.toggle('above', !downwards)
  box.style.visibility = ''
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

// Opens a box after a short hover with a mouse (the mouse just passing doesn't), closes when the
// mouse leaves, and on a click, a right-click or a scroll (the box would stay behind). Not while
// a button is held (a drag passing over). props go on the hovered element.
export function useHoverTip(delay = HOVER_DELAY) {
  const [open, setOpen] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const events = ['scroll', 'wheel', 'pointerdown', 'contextmenu', 'keydown'] as const
    events.forEach((name) => document.addEventListener(name, close, true))
    return () => events.forEach((name) => document.removeEventListener(name, close, true))
  }, [open])
  function hide() {
    clearTimeout(timer.current)
    setOpen(false)
  }
  return {
    open,
    props: {
      onPointerEnter(e: ReactPointerEvent) {
        if (e.pointerType !== 'mouse' || e.buttons) return
        clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setOpen(true), delay)
      },
      onPointerLeave: hide,
      onWheel: hide, // before it opened
    },
  }
}

// The same box over something else (e.g. a Steam price in the Games lists), with a mouse only.
// tip is only made while it's open, so what it shows can be asked for then.
export function HoverTip({ tip, className, children }: { tip: () => ReactNode; className?: string; children: ReactNode }) {
  const hover = useHoverTip()
  const ref = useRef<HTMLSpanElement>(null)
  return (
    <span
      ref={ref}
      className={className}
      title="" // no browser tooltip from around it (e.g. a tile's game name) over its box
      {...hover.props}
    >
      {children}
      {hover.open && <TipBox at={ref}>{tip()}</TipBox>}
    </span>
  )
}
