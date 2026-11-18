import { useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react'
import { flushSync } from 'react-dom'
import { animationsOn, play, TIMING } from './animations'
import { currentZoom } from './appearance'
import { channelKey, type FeedVideo } from './video'
import { moveToFolder } from './videoFolders'
import { changePlaylist } from './videoPlaylists'
import { leaveQueue, placeInQueue } from './videoQueue'

const OPEN_AFTER_MS = 600 // over a folded row this long: it opens, to reach what's inside
const EDGE = 30 // px from the page's top or bottom edge where it scrolls
const SCROLL_STEP = 8 // px per frame

// While a video that can join the Queue is lifted, VideoView shows the Queue's row even when it's
// empty, to drop into. drops counts drops into and out of the Queue: the list then skips its
// adding and removing animations (the rows are already where they go).
let lifted = false
let drops = 0
const listeners = new Set<() => void>()
function changed(next: { lifted?: boolean; dropped?: boolean }) {
  lifted = next.lifted ?? lifted
  if (next.dropped) drops++
  for (const listener of listeners) listener()
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export const useVideoLifted = () => useSyncExternalStore(subscribe, () => lifted)
export const useQueueDrops = () => useSyncExternalStore(subscribe, () => drops)

// Press and drag a video row onto a folder (rows with data-drop-channel, see FoldRow in
// VideoView.tsx), or onto its channel's row to take it out of its folder. toQueue: it can also go
// into the Queue (one the Queue would show, not in it yet); leaves: it then leaves its place (a
// loose To watch video). A playlist's video (episode) only goes into the Queue.
export function dragVideo(event: ReactPointerEvent<HTMLElement>, video: FeedVideo, { open, toQueue, episode }: {
  open: (id: string) => void
  toQueue?: { leaves: boolean }
  episode?: boolean
}) {
  const key = channelKey(video)
  dragToFolder(event, {
    from: video.folderId,
    // Only your own folders, and this video's channel with its sub-folders
    accepts: (el) => !episode && (!el.dataset.dropChannel || el.dataset.dropChannel === key),
    move: (folderId) => moveToFolder(video.id, folderId),
    open,
    queue: toQueue && { id: video.id, leaves: toQueue.leaves },
  })
}

// A playlist's row: only into your own folders. Out of one is by right-click (the main list isn't a
// drop place, like for videos without By channel).
export function dragPlaylist(event: ReactPointerEvent<HTMLElement>, playlistId: string, from: string | null, open: (id: string) => void) {
  dragToFolder(event, {
    from,
    accepts: (el) => el.dataset.dropChannel === '' && !!el.dataset.dropFolder,
    move: (folderId) => changePlaylist(playlistId, { folderId }),
    open,
  })
}

// Press and drag a Queue row up or down to change its place, among its own group's rows
// (data-queue-group): the ones it passes slide one place to make room, like the Board's cards.
// With the mouse under the Queue's last row it leaves the Queue: dimmed, the others close up.
export function dragInQueue(event: ReactPointerEvent<HTMLElement>) {
  if (event.button !== 0 || event.pointerType !== 'mouse' || (event.target as HTMLElement).closest('.video-row-action')) return
  const row = event.currentTarget
  const list = row.closest<HTMLElement>('.video-list')
  const page = row.closest<HTMLElement>('.page')
  const rows = list ? [...list.querySelectorAll<HTMLElement>(`[data-queue-group="${row.dataset.queueGroup}"]`)] : []
  if (!list || !page) return

  const index = rows.indexOf(row)
  const others = rows.filter((el) => el !== row)
  const startX = event.clientX
  const startY = event.clientY
  const grab = startY - row.getBoundingClientRect().top
  let pointerY = startY
  let started = false
  let frame = 0
  let place = index // how many of the others end up above it
  let out = false // under the Queue: leaves it

  // Each frame, as the page can scroll under a mouse that doesn't move. Places are measured in the
  // list's own pixels (offsetTop: no scroll, no transforms), the mouse in the screen's (zoom).
  function tick() {
    if (!row.isConnected) return end()
    const box = page!.getBoundingClientRect()
    if (pointerY < box.top + EDGE) page!.scrollTop -= SCROLL_STEP
    else if (pointerY > box.bottom - EDGE) page!.scrollTop += SCROLL_STEP
    row.style.transform = ''
    const top = row.getBoundingClientRect().top
    const dy = (pointerY - grab - top) / currentZoom()
    row.style.transform = `translateY(${dy}px)`
    const last = rows[rows.length - 1]
    out = row.offsetTop + (pointerY - top) / currentZoom() > last.offsetTop + last.offsetHeight
    row.classList.toggle('leaving', out)
    // Its leading edge passing another row's middle swaps them
    const edge = row.offsetTop + dy + (dy > 0 ? row.offsetHeight : 0)
    place = others.findIndex((el) => edge < el.offsetTop + el.offsetHeight / 2)
    if (place === -1) place = others.length
    const shift = row.offsetHeight
    others.forEach((el, k) => {
      const by = out ? (k >= index ? -shift : 0) : k >= place && k < index ? shift : k < place && k >= index ? -shift : 0
      el.style.transform = by ? `translateY(${by}px)` : ''
    })
    frame = requestAnimationFrame(tick)
  }

  const move = (e: PointerEvent) => {
    pointerY = e.clientY
    if (started || Math.hypot(e.clientX - startX, e.clientY - startY) < 4) return
    started = true
    row.classList.add('lifted')
    list!.classList.add('dragging', 'reordering')
    tick()
  }
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && end()

  function end(e?: Event) {
    cancelAnimationFrame(frame)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    window.removeEventListener('keydown', onKey)
    if (!started) return
    // The click that ends a drag mustn't also open the video
    const swallow = (c: Event) => c.stopPropagation()
    window.addEventListener('click', swallow, { capture: true, once: true })
    window.setTimeout(() => window.removeEventListener('click', swallow, true), 0)
    const from = row.style.transform
    row.classList.remove('lifted', 'leaving')
    list!.classList.remove('dragging')
    const id = (el: HTMLElement | undefined) => el?.dataset.queueId ?? null
    if (e?.type === 'pointerup' && (out || place !== index)) {
      // Drawn in the new order at once, then the transforms go without sliding (already in place)
      flushSync(() => {
        if (out) {
          leaveQueue([id(row)!])
          changed({ dropped: true })
        } else placeInQueue(id(row)!, id(others[place]), id(others[place - 1]))
      })
      list!.classList.add('settling')
      for (const el of rows) el.style.transform = ''
      requestAnimationFrame(() => list!.classList.remove('settling', 'reordering'))
      return
    }
    // Not moved: the others slide back (CSS), and so does it. Its end is taken off, or it would
    // hold the row still next time.
    for (const el of others) el.style.transform = ''
    row.style.transform = ''
    window.setTimeout(() => list!.classList.remove('reordering'), 200)
    if (animationsOn()) {
      const back = play(row, [{ transform: from }, { transform: 'none' }], TIMING.closeSmall)
      if (back) back.onfinish = () => back.cancel()
    }
  }

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
  window.addEventListener('keydown', onKey)
}

// The row only moves up and down, like the Board's cards, and goes by the mouse's height, so leaving
// the list sideways is fine. from = the folder it's in (null: none). queue: it can go into the Queue
// too (dragVideo): over its videos they open a gap where it would go, over its folded or empty row
// that row lights up like a folder (it goes at the end).
function dragToFolder(event: ReactPointerEvent<HTMLElement>, { from, accepts, move: moveTo, open, queue }: {
  from: string | null
  accepts: (row: HTMLElement) => boolean
  move: (folderId: string | null) => Promise<void>
  open: (id: string) => void
  queue?: { id: string; leaves: boolean }
}) {
  if (event.button !== 0 || event.pointerType !== 'mouse' || (event.target as HTMLElement).closest('.video-row-action')) return
  const row = event.currentTarget
  const list = row.closest<HTMLElement>('.video-list')
  const page = row.closest<HTMLElement>('.page')
  // No row it can go to on screen (or one channel chosen), and not for the Queue: nowhere to go
  if (!list || !page || (!queue && ![...list.querySelectorAll<HTMLElement>('[data-drop-channel]')].some(accepts))) return

  const startX = event.clientX
  const startY = event.clientY
  const grab = startY - row.getBoundingClientRect().top
  let pointerY = startY
  let started = false
  let frame = 0
  let openTimer = 0
  let over: HTMLElement | null = null
  let spot: QueueSpot | null = null
  let gapAt = -1 // the list's row the gap opens before (-1: none)

  const folderOf = (el: HTMLElement) => el.dataset.dropFolder || null
  const changesPlace = (el: HTMLElement) => el.dataset.queueHead !== undefined || folderOf(el) !== from

  // Where it would go in the Queue (its row data-queue-head, its videos data-queue-group), measured
  // in the list's own pixels: the Queue's row itself when folded or empty, else before the video
  // whose middle is under the mouse (over the Queue's row: first; a little under the last: last)
  function queueSpot(at: number): QueueSpot | null {
    const head = list!.querySelector<HTMLElement>('[data-queue-head]')
    if (!queue || !head) return null
    const rows = [...list!.querySelectorAll<HTMLElement>('[data-queue-group]')]
    const last = rows[rows.length - 1]
    if (head.classList.contains('folded') || !last) return at >= head.offsetTop && at < head.offsetTop + head.offsetHeight ? { head } : null
    if (at < head.offsetTop || at > last.offsetTop + last.offsetHeight + head.offsetHeight / 2) return null
    const place = rows.findIndex((el) => at < el.offsetTop + el.offsetHeight / 2)
    return { rows, place: place === -1 ? rows.length : place }
  }

  // The gap: the rows from there move down by its height, down to its own place when it leaves it
  // (they close up behind it), all of them when it stays (a copy joins the Queue)
  function openGap(next: QueueSpot | null) {
    const items = [...list!.children] as HTMLElement[]
    const at = !next || 'head' in next ? -1 : next.place < next.rows.length ? items.indexOf(next.rows[next.place]) : items.indexOf(next.rows[next.rows.length - 1]) + 1
    if (at === gapAt) return
    gapAt = at
    const own = items.indexOf(row)
    items.forEach((el, k) => {
      if (el === row) return
      const by = at >= 0 && k >= at && (!queue!.leaves || k < own)
      el.style.transform = by ? `translateY(${row.offsetHeight}px)` : ''
    })
  }

  function setOver(el: HTMLElement | null) {
    if (el !== over) {
      over?.classList.remove('drop-into')
      window.clearTimeout(openTimer)
      over = el
      if (el?.classList.contains('folded')) openTimer = window.setTimeout(() => open(el.dataset.open!), OPEN_AFTER_MS)
    }
    // Again each time: opening rewrites the row's classes
    over?.classList.toggle('drop-into', changesPlace(over))
  }

  // Each frame, as the page can scroll and rows can open under a mouse that doesn't move
  function tick() {
    if (!row.isConnected) return end()
    const box = page!.getBoundingClientRect()
    if (pointerY < box.top + EDGE) page!.scrollTop -= SCROLL_STEP
    else if (pointerY > box.bottom - EDGE) page!.scrollTop += SCROLL_STEP
    row.style.transform = ''
    const top = row.getBoundingClientRect().top
    row.style.transform = `translateY(${(pointerY - grab - top) / currentZoom()}px)`
    spot = queueSpot(row.offsetTop + (pointerY - top) / currentZoom())
    openGap(spot)
    if (spot) setOver('head' in spot ? spot.head : null)
    else {
      const { left, width } = list!.getBoundingClientRect()
      const under = document.elementFromPoint(left + width / 2, pointerY)?.closest<HTMLElement>('[data-drop-channel]')
      setOver(under && accepts(under) ? under : null)
    }
    frame = requestAnimationFrame(tick)
  }

  const move = (e: PointerEvent) => {
    pointerY = e.clientY
    if (started || Math.hypot(e.clientX - startX, e.clientY - startY) < 4) return
    started = true
    row.classList.add('lifted')
    list!.classList.add('dragging', 'reordering')
    // The Queue's row shows at once, even empty, to be measured
    if (queue) flushSync(() => changed({ lifted: true }))
    tick()
  }
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && end()

  function end(e?: Event) {
    cancelAnimationFrame(frame)
    window.clearTimeout(openTimer)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    window.removeEventListener('keydown', onKey)
    if (!started) return
    // The click that ends a drag mustn't also open the video
    const swallow = (c: Event) => c.stopPropagation()
    window.addEventListener('click', swallow, { capture: true, once: true })
    window.setTimeout(() => window.removeEventListener('click', swallow, true), 0)
    const from = row.style.transform
    const target = over
    const into = e?.type === 'pointerup' ? spot : null
    setOver(null)
    row.classList.remove('lifted')
    list!.classList.remove('dragging')
    row.style.transform = ''
    if (into) {
      // Drawn in the Queue at once, then the gap goes without sliding (already in place)
      const id = (el: HTMLElement | undefined) => el?.dataset.queueId ?? null
      flushSync(() => {
        if ('head' in into) placeInQueue(queue!.id, null, null)
        else placeInQueue(queue!.id, id(into.rows[into.place]), id(into.rows[into.place - 1]))
        changed({ lifted: false, dropped: true })
      })
      list!.classList.add('settling')
      for (const el of list!.children) (el as HTMLElement).style.transform = ''
      requestAnimationFrame(() => list!.classList.remove('settling', 'reordering'))
      return
    }
    openGap(null)
    if (queue) changed({ lifted: false })
    window.setTimeout(() => list!.classList.remove('reordering'), 200)
    if (e?.type === 'pointerup' && target && changesPlace(target)) void moveTo(folderOf(target))
    else if (animationsOn()) {
      // Not moved: it slides back. Its end is taken off, or it would hold the row still next time.
      const back = play(row, [{ transform: from }, { transform: 'none' }], TIMING.closeSmall)
      if (back) back.onfinish = () => back.cancel()
    }
  }

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
  window.addEventListener('keydown', onKey)
}

type QueueSpot = { head: HTMLElement } | { rows: HTMLElement[]; place: number }
