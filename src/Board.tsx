import { useRef } from 'react'
import { ChevronRight } from 'lucide-react'
import { useLocalState } from './localState'

// The Board: a panel on the right with small cards (quick tasks, priority things),
// visible whatever note is open. Opened with the small tab in the middle of the window's right
// edge (App.tsx); while open, that tab sits on the panel's left edge and closes it.
// PC: pushes the note aside, its left edge can be dragged to resize it (width kept per device).
// Phone (narrow screen): slides over the note, like the notes sidebar; the backdrop closes it.

const MIN_WIDTH = 200
const MAX_WIDTH = 600

interface Props {
  onClose: () => void
}

function Board({ onClose }: Props) {
  const [width, setWidth] = useLocalState('syncr.boardWidth', 280)
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)

  function startResize(event: React.PointerEvent) {
    event.preventDefault()
    drag.current = { startX: event.clientX, startWidth: width }
    // Capture: keeps getting the moves even when the pointer leaves the thin handle
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function resize(event: React.PointerEvent) {
    if (!drag.current) return
    // The handle is on the left edge: moving left makes the panel wider
    const next = drag.current.startWidth + (drag.current.startX - event.clientX)
    setWidth(Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next))))
  }

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <aside className="board" style={{ '--board-width': `${width}px` } as React.CSSProperties}>
        <div
          className="board-resize"
          onPointerDown={startResize}
          onPointerMove={resize}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        />
        <button className="board-toggle" onClick={onClose} title="Hide the Board">
          <ChevronRight size={14} />
        </button>
        <div className="board-title">Board</div>
        <div className="board-empty">No cards yet</div>
      </aside>
    </>
  )
}

export default Board
