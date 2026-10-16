import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight, Plus } from 'lucide-react'
import { useLocalState } from './localState'
import { createCard, db, setCardDeleted } from './db'
import Card from './Card'

// The Board: a panel on the right with small cards (quick tasks, priority things),
// visible whatever note is open. Opened with the small tab in the middle of the window's right
// edge (App.tsx); while open, that tab sits on the panel's left edge and closes it.
// PC: pushes the note aside, its left edge can be dragged to resize it (width kept per device).
// Phone (narrow screen): slides over the note, like the notes sidebar; the backdrop closes it.

const MIN_WIDTH = 200
const MAX_WIDTH = 600
const UNDO_MS = 5000

interface Props {
  onClose: () => void
}

function Board({ onClose }: Props) {
  const [width, setWidth] = useLocalState('syncr.boardWidth', 280)
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)
  // Priority cards first, then the others; inside each part, in their order (new = bottom)
  const cards = useLiveQuery(
    async () =>
      (await db.cards.toArray())
        .filter((card) => !card.deleted)
        .sort((a, b) => Number(b.priority) - Number(a.priority) || a.order - b.order),
    [],
  )
  // The card just added gets the keyboard focus
  const [newCardId, setNewCardId] = useState<string | null>(null)
  // The card just deleted, while "Undo" is offered
  const [undoId, setUndoId] = useState<string | null>(null)

  useEffect(() => {
    if (!undoId) return
    const timer = window.setTimeout(() => setUndoId(null), UNDO_MS)
    return () => window.clearTimeout(timer)
  }, [undoId])

  async function addCard() {
    setNewCardId(await createCard())
  }

  function deleteCard(id: string) {
    setCardDeleted(id, true)
    setUndoId(id) // a newer delete replaces the offer (the older one stays deleted)
  }

  function undo() {
    if (undoId) setCardDeleted(undoId, false)
    setUndoId(null)
  }

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
        <div className="board-cards">
          {cards?.map((card) => (
            <Card
              key={card.id}
              card={card}
              autoFocus={card.id === newCardId}
              onDelete={() => deleteCard(card.id)}
            />
          ))}
          <button className="board-add" onClick={addCard} title="New card">
            <Plus size={15} />
          </button>
        </div>
        {undoId && (
          <div className="board-undo">
            Card deleted
            <button onClick={undo}>Undo</button>
          </div>
        )}
      </aside>
    </>
  )
}

export default Board
