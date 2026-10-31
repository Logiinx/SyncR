import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Info } from 'lucide-react'

// A small ⓘ after a label that explains it in a box below: opens on hover with a mouse, or on a
// click / tap (phone); closes when the mouse leaves, or on a click / tap anywhere else. The box
// looks like a menu (.context-menu) and unfolds like one.
export default function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
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
        type="button"
        className="info-tip-button"
        aria-label={label}
        aria-expanded={open}
        onPointerDown={(e) => (pointer.current = e.pointerType)}
        onClick={(e) => (e.detail === 0 || pointer.current !== 'mouse' ? setOpen((o) => !o) : setOpen(true))}
      >
        <Info size={14} />
      </button>
      {open && <span className="info-tip-box" role="tooltip">{children}</span>}
    </span>
  )
}
