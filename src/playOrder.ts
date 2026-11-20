import type { PointerEvent as ReactPointerEvent } from 'react'
import { changed, db, type Game } from './db'
import { currentZoom } from './appearance'
import { animationsOn, EASE_OPEN, TIMING } from './animations'

// To play › Not started: the play order, set by hand (dragged on the PC, Move up / Move down in the
// menu on a touch screen). Games with a place come first, in that order; games without one (new
// arrivals, or none placed yet) follow, oldest arrival first, so a new one joins at the bottom.

export const hasPlayOrder = (game: Game) => game.playOrder !== undefined && game.playOrderAt === game.statusAt

export function sortPlayOrder(games: Game[]): Game[] {
  return [...games].sort((a, b) => {
    const placedA = hasPlayOrder(a)
    if (placedA !== hasPlayOrder(b)) return placedA ? -1 : 1
    return (placedA ? a.playOrder! - b.playOrder! : 0) || a.statusAt - b.statusAt || a.id.localeCompare(b.id)
  })
}

type OrderChange = { id: string; playOrder: number; playOrderAt: number }
const MIN_GAP = 1e-6 // closer than this, two neighbours' places are numbered again

// What to save once `movedId` sits where it is in `ordered`: only its own place when all the others
// have one (halfway between its neighbours), else every game numbered 1, 2, 3… (only the changed ones)
export function orderChanges(ordered: Game[], movedId: string): OrderChange[] {
  const index = ordered.findIndex((g) => g.id === movedId)
  if (index < 0) return []
  if (ordered.every((g) => g.id === movedId || hasPlayOrder(g))) {
    const before = ordered[index - 1]?.playOrder
    const after = ordered[index + 1]?.playOrder
    const value =
      before === undefined ? (after === undefined ? 1 : after - 1) : after === undefined ? before + 1 : (before + after) / 2
    if (before === undefined || after === undefined || after - before > MIN_GAP) {
      return [{ id: movedId, playOrder: value, playOrderAt: ordered[index].statusAt }]
    }
  }
  return ordered
    .map((g, i) => ({ id: g.id, playOrder: i + 1, playOrderAt: g.statusAt }))
    .filter((change, i) => !(hasPlayOrder(ordered[i]) && ordered[i].playOrder === change.playOrder))
}

// Saved in one go, so the list updates once (not game by game)
export async function savePlayOrder(ordered: Game[], movedId: string) {
  const changes = orderChanges(ordered, movedId)
  if (changes.length === 0) return
  const now = Date.now()
  await db.transaction('rw', db.games, async () => {
    for (const { id, ...change } of changes) await db.games.update(id, { ...change, updatedAt: now })
  })
  changed()
}

const notStarted = async () => sortPlayOrder(await db.games.filter((g) => !g.deleted && g.status === 'upnext').toArray())

// Move up / Move down (menu on a touch screen). Nothing at the ends.
export async function moveInPlayOrder(game: Game, step: -1 | 1) {
  const list = await notStarted()
  const from = list.findIndex((g) => g.id === game.id)
  const to = from + step
  if (from < 0 || to < 0 || to >= list.length) return
  await savePlayOrder(moveItem(list, from, to), game.id)
}

// Its place in the list (the menu grays Move up on the first, Move down on the last)
export async function playOrderPlace(game: Game) {
  const list = await notStarted()
  const index = list.findIndex((g) => g.id === game.id)
  return { first: index === 0, last: index === list.length - 1 }
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const result = [...list]
  const [item] = result.splice(from, 1)
  result.splice(to, 0, item)
  return result
}

// ---------- Dragging (PC, mouse) ----------

const START = 5 // px the mouse moves before a press becomes a drag (less = a click: opens the game)
const EDGE = 48 // px from the visible area's top or bottom where the page scrolls by itself
const SPEED = 12 // px per frame at the very edge

// Press a game of the list (`event.currentTarget`, its children being the games, each with
// data-game-id) and drag it: it follows the mouse and the others glide to where they'd go (each
// takes the place of the game at its new index, measured when the drag starts: grid or list
// alike). Only moves, no scaling. onDrop gets the new order and must show it at once (flushSync),
// so the games can be let go in their new places.
export function dragPlayOrder(event: ReactPointerEvent<HTMLElement>, onDrop: (from: number, to: number) => void) {
  if (event.button !== 0 || event.pointerType !== 'mouse') return
  const list = event.currentTarget
  const found = (event.target as HTMLElement).closest<HTMLElement>('[data-game-id]')
  if (!found || found.parentElement !== list) return
  const item = found
  const page = list.closest<HTMLElement>('.page')
  const items = [...list.children] as HTMLElement[]
  const from = items.indexOf(item)
  const start = { x: event.clientX, y: event.clientY }
  const pointer = { ...start }
  const startScroll = page?.scrollTop ?? 0
  let slots: { x: number; y: number }[] = [] // each game's middle when the drag started
  let started = false
  let to = from
  let frame = 0
  let top = 0 // the visible area, under the pinned bars
  let bottom = 0

  function place() {
    const zoom = currentZoom()
    const scrolled = (page?.scrollTop ?? 0) - startScroll
    item.style.transform = `translate(${(pointer.x - start.x) / zoom}px, ${(pointer.y - start.y + scrolled) / zoom}px)`
    // The nearest place to the mouse, among the places measured at the start
    const at = { x: pointer.x, y: pointer.y + scrolled }
    let best = Infinity
    slots.forEach((slot, i) => {
      const distance = Math.hypot(slot.x - at.x, slot.y - at.y)
      if (distance < best) [best, to] = [distance, i]
    })
    items.forEach((el, k) => {
      if (el === item) return
      const n = from < to && k > from && k <= to ? k - 1 : to < from && k >= to && k < from ? k + 1 : k
      el.style.transform = n === k ? '' : `translate(${(slots[n].x - slots[k].x) / zoom}px, ${(slots[n].y - slots[k].y) / zoom}px)`
    })
  }
  function tick() {
    if (page) {
      const speed =
        pointer.y < top + EDGE ? -SPEED * Math.min(1, (top + EDGE - pointer.y) / EDGE)
        : pointer.y > bottom - EDGE ? SPEED * Math.min(1, (pointer.y - bottom + EDGE) / EDGE)
        : 0
      if (speed) page.scrollTop += speed
    }
    place()
    frame = requestAnimationFrame(tick)
  }
  function begin() {
    started = true
    slots = items.map((el) => {
      const box = el.getBoundingClientRect()
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    })
    const area = page?.getBoundingClientRect()
    const bars = page ? [...page.querySelectorAll('.pinned-bar')].map((bar) => bar.getBoundingClientRect().bottom) : []
    top = Math.max(area?.top ?? 0, ...bars)
    bottom = area?.bottom ?? innerHeight
    list.classList.add('ordering')
    item.classList.add('lifted')
    frame = requestAnimationFrame(tick)
  }
  function onMove(e: PointerEvent) {
    pointer.x = e.clientX
    pointer.y = e.clientY
    if (!started && Math.hypot(pointer.x - start.x, pointer.y - start.y) > START) begin()
  }
  // The click that ends a drag doesn't open the game (taken away at once if no click comes)
  const swallow = (e: Event) => e.stopPropagation()
  function onUp(e: PointerEvent) {
    removeEventListener('pointermove', onMove)
    removeEventListener('pointerup', onUp)
    removeEventListener('pointercancel', onUp)
    if (!started) return
    cancelAnimationFrame(frame)
    // Where the mouse is now (the last frame may be behind it)
    if (e.type === 'pointerup') {
      pointer.x = e.clientX
      pointer.y = e.clientY
      place()
    } else to = from // cancelled (e.g. the window lost the mouse): back where it was
    addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => removeEventListener('click', swallow, true), 0)
    const was = item.getBoundingClientRect()
    list.classList.add('settling') // the others are already in place: no glide back
    if (to !== from) onDrop(from, to) // the list now shows its new order
    items.forEach((el) => (el.style.transform = ''))
    item.classList.remove('lifted')
    // The dropped game glides from under the mouse into its place
    const now = item.getBoundingClientRect()
    const zoom = currentZoom()
    if (animationsOn()) {
      item.animate(
        [{ transform: `translate(${(was.left - now.left) / zoom}px, ${(was.top - now.top) / zoom}px)` }, { transform: 'none' }],
        { duration: TIMING.openSmall, easing: EASE_OPEN },
      )
    }
    requestAnimationFrame(() => list.classList.remove('ordering', 'settling'))
  }
  addEventListener('pointermove', onMove)
  addEventListener('pointerup', onUp)
  addEventListener('pointercancel', onUp)
}
