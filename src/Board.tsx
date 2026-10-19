import { Fragment, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight, Plus, StickyNote } from 'lucide-react'
import { useLocalState } from './localState'
import {
  createCard,
  createGroup,
  db,
  isEmptyCard,
  moveCard,
  moveToGroup,
  setCardDeleted,
  updateGame,
  type Card as CardData,
} from './db'
import Card from './Card'
import CardGroup from './CardGroup'
import GameCard from './GameCard'
import ContextMenu from './ContextMenu'
import GameDialog from './GameDialog'
import Dialog, { type DialogRequest } from './Dialog'

// The Board: a panel on the right with small cards (quick tasks, priority things),
// visible whatever note is open. Opened with the small tab in the middle of the window's right
// edge (App.tsx); while open, that tab sits on the panel's left edge and closes it.
// PC: pushes the note aside, its left edge can be dragged to resize it (width kept per device).
// Phone (narrow screen): slides over the note, like the notes sidebar; the backdrop closes it.

const MIN_WIDTH = 200
const MAX_WIDTH = 600
const UNDO_MS = 5000
const HOLD_MS = 300 // touch screens: hold a card this long before it moves (a swipe scrolls)
const GAP = 6 // px between cards (.board-cards gap)

// Priority cards first, then the others; inside each part, in their order (new = bottom)
const byPart = (a: CardData, b: CardData) => Number(b.priority) - Number(a.priority) || a.order - b.order

interface Props {
  onClose: () => void
}

function Board({ onClose }: Props) {
  const [width, setWidth] = useLocalState('syncr.boardWidth', 280)
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)
  const rows = useLiveQuery(async () => (await db.cards.toArray()).filter((card) => !card.deleted), [])
  // Groups (CardGroup.tsx) sit among the cards; a card whose group is gone shows on its own
  const groups = rows?.filter((row) => row.group) ?? []
  const inGroup = (card: CardData) => !card.group && groups.some((group) => group.id === card.groupId)
  const groupCards = (id: string) => rows!.filter((row) => !row.group && row.groupId === id).sort(byPart)
  // What's directly on the Board: cards not in a group, and the groups
  const cards = rows?.filter((row) => !inGroup(row)).sort(byPart)
  const listRef = useRef<HTMLDivElement>(null)
  // After dropping a card: puts the cards back in place once the new order is on screen
  const settle = useRef<(() => void) | null>(null)
  // True while a card is being dragged (moved, not just pressed)
  const cardMoving = useRef(false)
  // The card just added gets the keyboard focus
  const [newCardId, setNewCardId] = useState<string | null>(null)
  // The card (or group) just deleted, while "Undo" is offered: what it brings back
  const [undo, setUndo] = useState<{ ids: string[]; label: string } | null>(null)
  // "Move to group" in a card's menu: the groups to choose from
  const [groupMenu, setGroupMenu] = useState<{ cardId: string; x: number; y: number } | null>(null)
  // A pinned game's details (click its card), and the "Remove game?" question from there
  const [openGame, setOpenGame] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogRequest | null>(null)

  // Opening the Board: remove cards left empty last time (e.g. the Board was closed while
  // a new card was still empty). Clicking away from an empty card removes it right away (Card.tsx).
  useEffect(() => {
    db.cards.toArray().then((all) => {
      for (const card of all) if (!card.deleted && isEmptyCard(card)) setCardDeleted(card.id, true)
    })
  }, [])

  useEffect(() => settle.current?.(), [rows])

  // Touch: once a card moves, the finger mustn't scroll the list. Added once, not at each press:
  // Chrome decides when a touch starts whether a touchmove listener may block scrolling.
  useEffect(() => {
    const list = listRef.current!
    const blockScroll = (e: TouchEvent) => {
      if (cardMoving.current) e.preventDefault()
    }
    list.addEventListener('touchmove', blockScroll, { passive: false })
    return () => list.removeEventListener('touchmove', blockScroll)
  }, [])

  useEffect(() => {
    if (!undo) return
    const timer = window.setTimeout(() => setUndo(null), UNDO_MS)
    return () => window.clearTimeout(timer)
  }, [undo])

  async function addCard() {
    setNewCardId(await createCard())
  }

  function deleteCard(id: string) {
    setCardDeleted(id, true)
    setUndo({ ids: [id], label: 'Card deleted' }) // a newer delete replaces the offer (the older one stays deleted)
  }

  // Moving a card (or a group, by its header): press on it and drag (on a touch screen, hold it
  // a moment first, so a swipe still scrolls). It follows the pointer and the others slide out
  // of the way. Where it is when you let go decides the spot: above the separator = priority,
  // below = normal. Moves are CSS transforms set directly, so React doesn't redraw on each move.
  // A card can also go into or out of a group: under an open group's header or among its cards
  // = in it (the group's line turns blue), past its bottom = out; over the middle of a folded
  // group = into it (the pile lights up). Groups only move among the cards, never into a group.
  function pressCard(id: string, event: React.PointerEvent) {
    const list = listRef.current
    const card = rows?.find((c) => c.id === id)
    // Even a single card can be dragged: the "Priority" / "Normal" zone lets it change side
    if (event.button !== 0 || !list || !rows || !cards || !card) return
    const allCards = rows
    const topLevel = cards
    const isGroup = !!card.group
    const groupNow = inGroup(card) ? card.groupId! : null
    const touch = event.pointerType === 'touch'
    const start = { x: event.clientX, y: event.clientY }
    let pointerY = event.clientY
    let started = false
    let target: { priority: boolean; order: number; groupId: string | null; into: boolean } | null = null
    // Measured when the drag starts
    let items: HTMLElement[] = []
    let dragged: HTMLElement | null = null
    let others: HTMLElement[] = []
    let index = 0
    let shift = 0
    let startY = 0
    let zone: HTMLElement | null = null
    const contentY = (clientY: number) => clientY - list.getBoundingClientRect().top + list.scrollTop

    function begin() {
      const draggedEl = list!.querySelector<HTMLElement>(`[data-card-id="${id}"]`)
      if (!draggedEl) return
      const topBefore = draggedEl.offsetTop
      // All cards on the Board on one side (no separator): a temporary zone takes its place, so
      // the card can still change side. All normal: "Priority" at the top; all priority: "Normal"
      // at the bottom. (Inside a group, a card dropped without a separator takes its neighbours' side.)
      if (!list!.querySelector(':scope > .board-separator')) {
        const rest = topLevel.filter((c) => c.id !== id)
        const side = rest.length ? rest[0].priority : card!.priority
        zone = document.createElement('div')
        zone.className = 'board-separator board-drop-zone'
        zone.textContent = side ? 'Normal ↓' : 'Priority ↑'
        if (side) list!.append(zone)
        else list!.prepend(zone)
      }
      // In page order: a group being moved passes whole groups; a card passes group headers
      // and the cards inside open groups one by one
      items = [
        ...list!.querySelectorAll<HTMLElement>(
          isGroup
            ? ':scope > .card, :scope > .card-group, :scope > .board-separator'
            : ':scope > .card, :scope > .board-separator, .card-group-head, .card-group-cards > .card, .card-group-cards > .board-separator',
        ),
      ]
      dragged = draggedEl
      index = items.indexOf(dragged)
      others = items.filter((el) => el !== dragged)
      shift = dragged.offsetHeight + GAP
      // The zone pushed the cards down: keep the dragged one under the pointer
      startY = contentY(start.y) + (dragged.offsetTop - topBefore)
      started = true
      cardMoving.current = true
      list!.classList.add('dragging')
      dragged.classList.add('lifted')
      update()
    }

    function update() {
      if (!dragged) return
      const dy = contentY(pointerY) - startY
      dragged.style.transform = `translateY(${dy}px) scale(1.02)`
      // The leading edge (top when moving up, bottom when moving down) passing another card's
      // middle swaps them, so a tall card doesn't have to cover a short one first.
      const edge = dragged.offsetTop + dy + (dy > 0 ? dragged.offsetHeight : 0)
      // j = how many of the other cards (and the separator) end up above it
      let j = others.findIndex((el) => edge < el.offsetTop + el.offsetHeight / 2)
      if (j === -1) j = others.length

      // The group an element is inside (a card or separator in an open group), else null
      const groupOf = (el?: HTMLElement) =>
        el?.closest('.card-group-cards') ? el.closest<HTMLElement>('.card-group')!.dataset.cardId! : null
      // The card (or group, for a header) an element shows
      const cardOf = (el?: HTMLElement) =>
        el && allCards.find((c) => c.id === el.closest<HTMLElement>('[data-card-id]')?.dataset.cardId)
      const y = contentY(pointerY)

      // Which open group it goes in: the pointer decides (below the middle of its header, above
      // its bottom), not the card's edge, which for a tall card can be far past the group. The
      // spot then stays among that group's cards, or outside every group.
      let groupId: string | null = null
      if (!isGroup) {
        others.forEach((head, h) => {
          if (!head.classList.contains('card-group-head') || head.parentElement!.classList.contains('folded')) return
          const box = head.parentElement!
          const id = box.dataset.cardId!
          let last = h // its last card (or the header, if it has none)
          while (last + 1 < others.length && groupOf(others[last + 1]) === id) last++
          const inside = y >= box.offsetTop + head.offsetHeight / 2 && y < box.offsetTop + box.offsetHeight
          if (inside) {
            groupId = id
            j = Math.min(Math.max(j, h + 1), last + 1)
          } else if (j > h && j <= last) {
            j = y < box.offsetTop + box.offsetHeight / 2 ? h : last + 1
          }
        })
      }

      // Pointer over the middle of a folded group: into it. The group then stays where it is
      // (the spot is kept on the dragged card's side of it), so it doesn't slide away from the pointer.
      const h = isGroup
        ? -1
        : others.findIndex(
            (el) =>
              el.classList.contains('card-group-head') &&
              el.parentElement!.classList.contains('folded') &&
              Math.abs(y - (el.offsetTop + el.offsetHeight / 2)) < el.offsetHeight * 0.3,
          )
      const intoHead = h >= 0 ? others[h] : undefined
      if (intoHead) j = index <= h ? Math.min(j, h) : Math.max(j, h + 1)

      // Make room: the ones it passed slide one place towards where it came from
      const offsets = others.map((_, k) => (k >= j && k < index ? shift : k < j && k >= index ? -shift : 0))
      others.forEach((el, k) => (el.style.transform = offsets[k] ? `translateY(${offsets[k]}px)` : ''))

      let priority = card!.priority
      let order = card!.order
      if (intoHead) {
        groupId = intoHead.parentElement!.dataset.cardId!
      } else {
        // The cards there (separators, and cards of other groups, don't count)
        const inPlace = (el: HTMLElement) => !el.classList.contains('board-separator') && groupOf(el) === groupId
        const before = others.slice(0, j).filter(inPlace)
        const after = others.slice(j).filter(inPlace)
        // Above the separator (or the "Priority" zone) = priority; no separator: its neighbours' side
        const separator = others.findIndex((el) => el.classList.contains('board-separator') && groupOf(el) === groupId)
        priority = separator >= 0 ? j <= separator : (cardOf(before.at(-1)) ?? cardOf(after[0]) ?? card!).priority
        // New order: between its neighbours on that side
        const sameSide = (el: HTMLElement) => cardOf(el)?.priority === priority
        const prev = cardOf(before.filter(sameSide).at(-1))
        const next = cardOf(after.find(sameSide))
        order = prev && next ? (prev.order + next.order) / 2 : prev ? prev.order + 1 : next ? next.order - 1 : card!.order
      }
      // Preview: the dragged card already looks like it will once dropped (blue tint or not),
      // and the group it goes into is marked
      dragged.classList.toggle('priority', priority)
      for (const el of list!.querySelectorAll<HTMLElement>('.card-group')) {
        el.classList.toggle('drop-target', !intoHead && el.dataset.cardId === groupId)
        el.classList.toggle('drop-into', el === intoHead?.parentElement)
      }
      target = { priority, order, groupId, into: !!intoHead }
    }

    const holdTimer = touch ? window.setTimeout(begin, HOLD_MS) : undefined

    const move = (e: PointerEvent) => {
      pointerY = e.clientY
      if (!started) {
        const distance = Math.hypot(e.clientX - start.x, e.clientY - start.y)
        if (touch) {
          if (distance > 8) end() // moved before the hold: it's a swipe, let the list scroll
          return
        }
        if (distance < 4) return
        begin()
      }
      // Near the top or bottom edge: scroll the list
      const box = list.getBoundingClientRect()
      if (e.clientY < box.top + 30) list.scrollTop -= 8
      else if (e.clientY > box.bottom - 30) list.scrollTop += 8
      update()
    }
    // Touch: the long press mustn't open the menu
    const blockMenu = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
    }

    function end(e?: Event) {
      window.clearTimeout(holdTimer)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      cardMoving.current = false
      window.removeEventListener('contextmenu', blockMenu, true)
      if (!started || !dragged) return
      const lifted = dragged
      // The click that ends a drag mustn't also act (e.g. open a link)
      const swallow = (c: Event) => c.stopPropagation()
      window.addEventListener('click', swallow, { capture: true, once: true })
      window.setTimeout(() => window.removeEventListener('click', swallow, true), 0)

      const putBack = () => {
        zone?.remove()
        for (const el of items) el.style.transform = ''
        for (const el of list!.querySelectorAll('.card-group')) el.classList.remove('drop-target', 'drop-into')
        lifted.classList.remove('lifted')
        list!.classList.remove('dragging')
      }
      const moved =
        e?.type === 'pointerup' &&
        target &&
        (target.groupId !== groupNow ||
          (!target.into && (target.priority !== card!.priority || target.order !== card!.order)))
      if (moved && target) {
        // Once the new order is on screen, drop the transforms without animation
        settle.current = () => {
          settle.current = null
          list!.classList.add('settling')
          putBack()
          requestAnimationFrame(() => list!.classList.remove('settling'))
        }
        if (target.into) moveToGroup(id, target.groupId!)
        else moveCard(id, target.priority, target.order, isGroup ? undefined : target.groupId)
        window.setTimeout(() => settle.current?.(), 500) // in case the list didn't change
      } else {
        lifted.classList.toggle('priority', card!.priority) // undo the preview
        putBack() // not moved: everything slides back
      }
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    if (touch) window.addEventListener('contextmenu', blockMenu, true)
  }

  // "Move to group": the other groups, a new one, or out of its group
  function groupMenuItems(cardId: string) {
    const card = rows?.find((row) => row.id === cardId)
    if (!card) return []
    return [
      ...groups
        .filter((group) => group.id !== card.groupId)
        .sort(byPart)
        .map((group) => ({ label: group.title ?? 'Group', onClick: () => moveToGroup(card.id, group.id) })),
      {
        label: 'New group…',
        divider: true,
        onClick: () =>
          setDialog({
            title: 'New group',
            input: { initial: '', placeholder: 'Group name' },
            confirmLabel: 'Create',
            onConfirm: (name) => name.trim() && createGroup(name.trim(), card.id),
          }),
      },
      ...(inGroup(card) ? [{ label: 'Remove from group', divider: true, onClick: () => moveToGroup(card.id, undefined) }] : []),
    ]
  }

  function renderCard(card: CardData) {
    const onMoveToGroup = (x: number, y: number) => setGroupMenu({ cardId: card.id, x, y })
    return card.game ? (
      <GameCard
        card={{ ...card, game: card.game }}
        onDelete={() => deleteCard(card.id)}
        onPress={(event) => pressCard(card.id, event)}
        onOpen={setOpenGame}
        onMoveToGroup={onMoveToGroup}
      />
    ) : (
      <Card
        card={card}
        autoFocus={card.id === newCardId}
        onDelete={() => deleteCard(card.id)}
        onPress={(event) => pressCard(card.id, event)}
        onMoveToGroup={onMoveToGroup}
      />
    )
  }

  // Cards in order, with a thin line between the priority ones and the others (only when both exist)
  function withSeparator(list: CardData[], render: (card: CardData) => React.ReactNode) {
    return list.map((card, index) => (
      <Fragment key={card.id}>
        {!card.priority && list[index - 1]?.priority && <div className="board-separator" />}
        {render(card)}
      </Fragment>
    ))
  }

  // "Remove from list" in a game's details: the game leaves your list, its card stays
  async function askRemoveGame(id: string) {
    const game = await db.games.get(id)
    if (!game) return
    setDialog({
      title: 'Remove game?',
      message: `"${game.name}" will be removed from your list, with its note and review. Its card stays on the Board.`,
      confirmLabel: 'Remove',
      danger: true,
      onConfirm: () => {
        setOpenGame(null)
        updateGame(game.id, { deleted: true })
      },
    })
  }

  function undoDelete() {
    for (const id of undo?.ids ?? []) setCardDeleted(id, false)
    setUndo(null)
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
          {!!rows?.length && <span className="board-count">{rows.filter((row) => !row.group).length}</span>}
          {/* New card: lands at the bottom of the normal cards, scrolled into view */}
          <button className="board-add" onClick={addCard} title="New card">
            <Plus size={16} />
          </button>
        </div>
        <div className="board-cards" ref={listRef}>
          {cards &&
            withSeparator(cards, (card) => {
              if (!card.group) return renderCard(card)
              const inside = groupCards(card.id)
              return (
                <CardGroup
                  group={card}
                  count={inside.length}
                  onPress={(event) => pressCard(card.id, event)}
                  onDialog={setDialog}
                  onDeleted={(ids) => setUndo({ ids, label: 'Group deleted' })}
                >
                  {withSeparator(inside, renderCard)}
                </CardGroup>
              )
            })}
        </div>
        {undo && (
          <div className="board-undo">
            {undo.label}
            <button onClick={undoDelete}>Undo</button>
          </div>
        )}
        {/* Phone only (CSS): the header "+" is hard to reach with the thumb */}
        <button className="board-add-row" onClick={addCard}>
          <Plus size={16} />
          New card
        </button>
        {openGame &&<GameDialog id={openGame} onClose={() => setOpenGame(null)} onRemove={() => askRemoveGame(openGame)} />}
        {groupMenu && (
          <ContextMenu
            x={groupMenu.x}
            y={groupMenu.y}
            onClose={() => setGroupMenu(null)}
            items={groupMenuItems(groupMenu.cardId)}
          />
        )}
        {dialog && <Dialog request={dialog} onClose={() => setDialog(null)} />}
      </aside>
    </>
  )
}

export default Board
