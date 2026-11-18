import { useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { Archive, Mail, MailOpen, Trash2 } from 'lucide-react'
import { animationsOn, EASE_CLOSE, EASE_OPEN, TIMING } from './animations'
import { currentZoom } from './appearance'
import { loadBackground, type MailDrag } from './desktop'
import { t } from './i18n'

// Press an email (Mail tab row, pop-up card) and drag it left or right, like Gmail's swipe: each
// side's action is chosen in Settings → Alerts (desktop.ts; Nothing: that side doesn't move).
// While dragging, a strip behind shows the action (icon + name), dim, then in its color once
// far enough. Let go before that: it slides back, nothing happens. Far enough: an action that
// takes the mail away (leaves) slides it out first, the others slide back as it runs.
// Only a sideways drag counts (a few px, more sideways than up or down); the click after it is
// dropped, so a normal click still opens the mail.
export type DragAction = Exclude<MailDrag, 'none'>

const START = 8 // px sideways before it's a drag
const FAR = 150 // px to let go past to run the action (at most 40% of the row's width)

export const dragActionName = (action: MailDrag, unread: boolean) =>
  action === 'read' ? (unread ? t('Mark as read') : t('Mark as unread'))
  : action === 'archive' ? t('Archive')
  : action === 'trash' ? t('Delete')
  : t('Nothing')

export function DragRow({ item, unread, leaves, onDrag, children }: {
  item?: string // data-item, for the list's animations
  unread: boolean // for read: which way it goes
  leaves: (action: DragAction) => boolean // the mail goes from this list after the action
  onDrag: (action: DragAction) => void
  children: ReactNode
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const overRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; y: number; dx: number; on: boolean; right: MailDrag; left: MailDrag; unread: boolean } | null>(null)
  // What the strip behind shows: the side being uncovered and whether it's far enough (unread:
  // as at the start, so its name doesn't flip while it slides back)
  const [shown, setShown] = useState<{ action: DragAction; right: boolean; far: boolean; unread: boolean } | null>(null)

  const far = () => Math.min(FAR, (rowRef.current?.offsetWidth ?? 0) * 0.4)
  const move = (to: number, leaving: boolean, done?: () => void) => {
    const over = overRef.current
    if (!over) return done?.()
    const from = over.style.transform
    over.style.transform = to ? `translateX(${to}px)` : ''
    if (!animationsOn()) return done?.()
    const animation = over.animate([{ transform: from || 'none' }, { transform: over.style.transform || 'none' }], {
      duration: leaving ? TIMING.closeSmall : TIMING.openSmall,
      easing: leaving ? EASE_CLOSE : EASE_OPEN,
    })
    if (done) animation.finished.then(done, done)
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return
    const { emailDragRight: right, emailDragLeft: left } = loadBackground()
    if (right === 'none' && left === 'none') return
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, on: false, right, left, unread }
  }

  function onPointerMove(e: PointerEvent) {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    const zoom = currentZoom() // the mouse moves in screen pixels, the row in the app's
    let dx = (e.clientX - d.x) / zoom
    const dy = (e.clientY - d.y) / zoom
    if (!d.on) {
      if (Math.abs(dy) > START && Math.abs(dy) > Math.abs(dx)) return void (drag.current = null) // scrolling
      if (Math.abs(dx) < START || Math.abs(dx) < Math.abs(dy)) return
      d.on = true
      try {
        rowRef.current?.setPointerCapture(e.pointerId) // follows it outside the row
      } catch {
        // the pointer is already gone
      }
      rowRef.current?.classList.add('dragging')
      overRef.current?.getAnimations().forEach((animation) => animation.cancel())
    }
    const action = dx > 0 ? d.right : d.left
    if (action === 'none') dx = 0
    d.dx = dx
    if (overRef.current) overRef.current.style.transform = dx ? `translateX(${dx}px)` : ''
    const next = action === 'none' || !dx ? null : { action, right: dx > 0, far: Math.abs(dx) >= far(), unread: d.unread }
    setShown((old) => (old?.action === next?.action && old?.right === next?.right && old?.far === next?.far ? old : next))
  }

  function onPointerUp(e: PointerEvent) {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    drag.current = null
    if (!d.on) return
    const row = rowRef.current
    // The click that follows the drag isn't one
    const dropClick = (click: MouseEvent) => {
      click.stopPropagation()
      click.preventDefault()
    }
    row?.addEventListener('click', dropClick, { capture: true, once: true })
    setTimeout(() => row?.removeEventListener('click', dropClick, { capture: true }), 0)
    const action = d.dx > 0 ? d.right : d.left
    const end = () => {
      row?.classList.remove('dragging')
      setShown(null)
    }
    if (e.type === 'pointercancel' || action === 'none' || Math.abs(d.dx) < far()) return move(0, false, end)
    if (leaves(action)) {
      // Out past its edge; the strip stays while the list closes up (it goes with the row)
      const width = row?.offsetWidth ?? 0
      move(Math.sign(d.dx) * (width + 16), true, () => onDrag(action))
    } else {
      onDrag(action)
      move(0, false, end)
    }
  }

  const Icon = !shown ? null
    : shown.action === 'archive' ? Archive
    : shown.action === 'trash' ? Trash2
    : shown.unread ? MailOpen : Mail
  return (
    <div
      ref={rowRef}
      data-item={item}
      className="drag-row"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {shown && Icon && (
        <div className={`drag-row-under ${shown.action}${shown.right ? ' right' : ''}${shown.far ? ' far' : ''}`} aria-hidden>
          <Icon size={16} />
          {dragActionName(shown.action, shown.unread)}
        </div>
      )}
      <div ref={overRef} className="drag-row-over">
        {children}
      </div>
    </div>
  )
}
