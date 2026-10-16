import { Fragment, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight, Plus, StickyNote } from 'lucide-react'
import { useLocalState } from './localState'
import { createCard, db, isEmptyCard, moveCard, setCardDeleted } from './db'
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
  const listRef = useRef<HTMLDivElement>(null)
  // While a card is dragged by its grip: which one, and where the blue drop line is
  const [cardDrag, setCardDrag] = useState<{ id: string; lineTop: number | null } | null>(null)
  // The card just added gets the keyboard focus
  const [newCardId, setNewCardId] = useState<string | null>(null)
  // The card just deleted, while "Undo" is offered
  const [undoId, setUndoId] = useState<string | null>(null)

  // Opening the Board: remove cards left empty last time (e.g. the Board was closed while
  // a new card was still empty). Clicking away from an empty card removes it right away (Card.tsx).
  useEffect(() => {
    db.cards.toArray().then((all) => {
      for (const card of all) if (!card.deleted && isEmptyCard(card)) setCardDeleted(card.id, true)
    })
  }, [])

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

  // Dragging a card by its ⋮⋮ grip. The drop spot is found from the pointer's height
  // against the middle of the other cards. Above the separator = priority, below = normal.
  function startDrag(id: string, event: React.PointerEvent) {
    const list = listRef.current
    const card = cards?.find((c) => c.id === id)
    if (!list || !cards || !card || cards.length < 2) return
    event.preventDefault()
    const others = cards.filter((c) => c.id !== id)
    const priorityCount = others.filter((c) => c.priority).length
    let target: { priority: boolean; order: number } | null = null
    setCardDrag({ id, lineTop: null })

    const move = (e: PointerEvent) => {
      const box = list.getBoundingClientRect()
      // Near the top or bottom edge: scroll the list
      if (e.clientY < box.top + 30) list.scrollTop -= 8
      else if (e.clientY > box.bottom - 30) list.scrollTop += 8

      const rects = others.map((c) =>
        list.querySelector(`[data-card-id="${c.id}"]`)!.getBoundingClientRect(),
      )
      // k = how many of the other cards end up above it
      let k = rects.findIndex((r) => e.clientY < r.top + r.height / 2)
      if (k === -1) k = others.length
      let priority: boolean
      if (k < priorityCount) priority = true
      else if (k > priorityCount) priority = false
      else if (priorityCount > 0 && priorityCount < others.length) {
        // Right between the two parts: the side of the gap (where the separator is) decides
        priority = e.clientY < (rects[k - 1].bottom + rects[k].top) / 2
      } else priority = card.priority // only one part: stays as it is

      // New order: between its neighbours in the same part
      const prev = others[k - 1]?.priority === priority ? others[k - 1] : undefined
      const next = others[k]?.priority === priority ? others[k] : undefined
      const order = prev && next ? (prev.order + next.order) / 2 : prev ? prev.order + 1 : next ? next.order - 1 : card.order
      target = { priority, order }

      // Blue line: under the card above it if that's in the same part, else over the card below
      const lineY = prev || !next ? rects[k - 1].bottom + 3 : rects[k].top - 3
      setCardDrag({ id, lineTop: lineY - box.top + list.scrollTop })
    }
    const end = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      setCardDrag(null)
      if (e.type === 'pointerup' && target && (target.priority !== card.priority || target.order !== card.order)) {
        moveCard(id, target.priority, target.order)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
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
        <div className="board-header">
          <StickyNote size={15} className="board-icon" />
          <span className="board-title">Board</span>
          {!!cards?.length && <span className="board-count">{cards.length}</span>}
          {/* New card: lands at the bottom of the normal cards, scrolled into view */}
          <button className="board-add" onClick={addCard} title="New card">
            <Plus size={16} />
          </button>
        </div>
        <div className={`board-cards${cardDrag ? ' dragging' : ''}`} ref={listRef}>
          {cards?.map((card, index) => (
            <Fragment key={card.id}>
              {/* A thin line between the priority cards and the others (only when both exist) */}
              {!card.priority && cards[index - 1]?.priority && <div className="board-separator" />}
              <Card
                card={card}
                autoFocus={card.id === newCardId}
                dragging={cardDrag?.id === card.id}
                onDelete={() => deleteCard(card.id)}
                onDragStart={(event) => startDrag(card.id, event)}
              />
            </Fragment>
          ))}
          {cardDrag?.lineTop != null && <div className="board-drop-line" style={{ top: cardDrag.lineTop }} />}
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
