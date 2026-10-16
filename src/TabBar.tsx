import { Plus } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { currentZoom } from './appearance'

// An open tab: a note, or the Games tab
export interface Tab {
  id: string
  title: string
}

interface Props {
  tabs: Tab[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
  onMenu: (id: string, x: number, y: number) => void
  onRename: (id: string) => void
  onReorder: (ids: string[]) => void
}

const MOUSE_DRAG_DISTANCE = 5 // px the mouse must move before a click becomes a drag
const TOUCH_HOLD_TIME = 400 // ms to hold a tab before it can be dragged on the phone
const TOUCH_SLOP = 8 // px a finger may move during the hold; more means it's a scroll

// A press on a tab that may turn into a drag
interface Gesture {
  id: string
  pointerId: number
  pointerType: string
  startX: number
  startY: number
  index: number
  rects: DOMRect[] // where every tab was when the press started
  held: boolean // touch: held long enough, can drag now
  dragging: boolean
  holdTimer?: number
}

interface Drag {
  id: string
  dx: number // how far the dragged tab follows the pointer
  to: number // where it would land
  shifts: number[] // how far each other tab slides aside to make room
  dropped: boolean // released, waiting for the new order to arrive
}

// The row of open notes at the top. Middle-click closes, double-click renames, right-click opens a menu.
// Drag a tab to move it (phone: hold, then drag; hold and release opens the menu).
function TabBar({ tabs, activeId, onSelect, onClose, onNew, onMenu, onRename, onReorder }: Props) {
  const tabRefs = useRef(new Map<string, HTMLDivElement>())
  const gesture = useRef<Gesture | null>(null)
  const suppressClick = useRef(false)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [lifted, setLifted] = useState<string | null>(null) // touch: held, ready to drag

  // After a drop, keep the tabs where they were dropped until the new order arrives
  // (it comes from the database a moment later), then remove the offsets in the same frame.
  const order = tabs.map((tab) => tab.id).join()
  useLayoutEffect(() => {
    setDrag((current) => (current?.dropped ? null : current))
  }, [order])

  // While dragging with a finger, stop the tab row from scrolling
  const navRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const nav = navRef.current!
    const onTouchMove = (e: TouchEvent) => {
      if (gesture.current?.held) e.preventDefault()
    }
    nav.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => nav.removeEventListener('touchmove', onTouchMove)
  }, [])

  function reset() {
    clearTimeout(gesture.current?.holdTimer)
    gesture.current = null
    setLifted(null)
  }

  function onPointerDown(e: React.PointerEvent, id: string, index: number) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.tab-close')) return
    const rects = tabs.map((tab) => tabRefs.current.get(tab.id)!.getBoundingClientRect())
    const g: Gesture = {
      id,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      startX: e.clientX,
      startY: e.clientY,
      index,
      rects,
      held: false,
      dragging: false,
    }
    if (e.pointerType === 'touch') {
      g.holdTimer = window.setTimeout(() => {
        g.held = true
        setLifted(id)
      }, TOUCH_HOLD_TIME)
    }
    gesture.current = g
  }

  function onPointerMove(e: React.PointerEvent) {
    const g = gesture.current
    if (!g || e.pointerId !== g.pointerId) return
    const dx = e.clientX - g.startX
    const distance = Math.hypot(dx, e.clientY - g.startY)

    if (!g.dragging) {
      if (g.pointerType === 'touch') {
        if (!g.held) {
          if (distance > TOUCH_SLOP) reset() // moved too early: it's a scroll
          return
        }
      } else if (distance < MOUSE_DRAG_DISTANCE) return
      g.dragging = true
      tabRefs.current.get(g.id)!.setPointerCapture(e.pointerId)
    }
    updateDrag(g, dx)
  }

  // Works out where the dragged tab would land and which tabs slide aside
  function updateDrag(g: Gesture, dx: number) {
    const { rects, index } = g
    const last = rects.length - 1
    // The tab stays within the row
    dx = Math.max(rects[0].left - rects[index].left, Math.min(rects[last].right - rects[index].right, dx))
    const center = (r: DOMRect) => (r.left + r.right) / 2
    // It takes a neighbor's place once its front edge passes that neighbor's middle
    let to = index
    while (to < last && rects[index].right + dx > center(rects[to + 1])) to++
    while (to > 0 && rects[index].left + dx < center(rects[to - 1])) to--
    // The space the dragged tab leaves: its width plus the gap between tabs
    const gap = last > 0 ? rects[1].left - rects[0].right : 0
    const slot = rects[index].width + gap
    const shifts = rects.map((_, i) => (i > index && i <= to ? -slot : i < index && i >= to ? slot : 0))
    setDrag({ id: g.id, dx, to, shifts, dropped: false })
  }

  function onPointerUp(e: React.PointerEvent) {
    const g = gesture.current
    if (!g || e.pointerId !== g.pointerId) return
    reset()
    if (g.dragging) {
      suppressClick.current = true
      setTimeout(() => (suppressClick.current = false))
      if (drag && drag.to !== g.index) {
        const ids = tabs.map((tab) => tab.id)
        ids.splice(drag.to, 0, ...ids.splice(g.index, 1))
        setDrag({ ...drag, dropped: true })
        onReorder(ids)
      } else setDrag(null)
    } else if (g.held) {
      // Held without moving: the menu, like a long-press anywhere else
      suppressClick.current = true
      setTimeout(() => (suppressClick.current = false))
      onMenu(g.id, e.clientX, e.clientY)
    }
  }

  function onPointerCancel() {
    reset()
    setDrag(null)
  }

  return (
    <>
      <nav className={drag ? 'tabs dragging' : 'tabs'} data-tauri-drag-region ref={navRef}>
        {tabs.map((tab, index) => {
          const isDragged = drag?.id === tab.id
          // Measured in screen pixels; the page is scaled by the app scaling setting
          const offset = (drag ? (isDragged ? drag.dx : drag.shifts[index]) : 0) / currentZoom()
          let className = tab.id === activeId ? 'tab active' : 'tab'
          if (isDragged) className += ' drag-source'
          if (lifted === tab.id) className += ' lifted'
          return (
            <div
              key={tab.id}
              ref={(el) => {
                if (el) tabRefs.current.set(tab.id, el)
                else tabRefs.current.delete(tab.id)
              }}
              className={className}
              style={offset ? { transform: `translateX(${offset}px)` } : undefined}
              onPointerDown={(e) => onPointerDown(e, tab.id, index)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              onClick={() => !suppressClick.current && onSelect(tab.id)}
              onAuxClick={(e) => e.button === 1 && onClose(tab.id)}
              onDoubleClick={() => onRename(tab.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                // Phone: the menu opens on release instead (see onPointerUp), so holding can drag
                if (gesture.current?.pointerType === 'touch') return
                onMenu(tab.id, e.clientX, e.clientY)
              }}
              title={tab.title}
            >
              <span className="tab-title">{tab.title}</span>
              <button
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(tab.id)
                }}
                title="Close tab"
              >
                ×
              </button>
            </div>
          )
        })}
      </nav>
      {/* Outside the scrolling strip, so it stays visible when there are many tabs */}
      <button className="tab-new" onClick={onNew} title="New note">
        <Plus size={18} />
      </button>
    </>
  )
}

export default TabBar
