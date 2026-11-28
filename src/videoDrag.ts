import { useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react'
import { flushSync } from 'react-dom'
import { animationsOn, play, TIMING } from './animations'
import { currentZoom } from './appearance'
import { channelKey, type FeedVideo } from './video'
import { moveToFolder } from './videoFolders'
import { changePlaylist } from './videoPlaylists'
import { leaveQueue, placeInQueue } from './videoQueue'
import { saveSectionOrder } from './videoSections'

const OPEN_AFTER_MS = 600 // over a folded row this long: it opens, to reach what's inside
const EDGE = 30 // px from the page's top or bottom edge where it scrolls
const SCROLL_STEP = 8 // px per frame

// The grid (VideoView's grid / list switch): a tile follows the mouse sideways too, and the others
// move by places in reading order (left to right, then down), from line to line when needed.
const isGrid = (list: HTMLElement) => list.classList.contains('grid')

// The mouse in the list's own pixels (offsetLeft / offsetTop: no scroll, no transforms), from the
// lifted row measured without its transform; the mouse is in the screen's (zoom)
function listPoint(row: HTMLElement, x: number, y: number) {
  const box = row.getBoundingClientRect()
  return { x: row.offsetLeft + (x - box.left) / currentZoom(), y: row.offsetTop + (y - box.top) / currentZoom() }
}

// Which tile a point comes before (-1: after them all): above its line, or on it left of its middle
function tileBefore(tiles: HTMLElement[], at: { x: number; y: number }) {
  return tiles.findIndex((el) => at.y < el.offsetTop || (at.y < el.offsetTop + el.offsetHeight && at.x < el.offsetLeft + el.offsetWidth / 2))
}

// Where a run of tiles' n-th place is (the first starts a line, after its header); one past the
// last = the next column, or the start of a new line under it
function slotOf(tiles: HTMLElement[], n: number, list: HTMLElement) {
  if (n < tiles.length) return { x: tiles[n].offsetLeft, y: tiles[n].offsetTop }
  const style = getComputedStyle(list)
  const columns = style.gridTemplateColumns.split(' ')
  const last = tiles[tiles.length - 1]
  if (n % columns.length === 0) return { x: tiles[0].offsetLeft, y: last.offsetTop + last.offsetHeight + (parseFloat(style.rowGap) || 0) }
  return { x: last.offsetLeft + parseFloat(columns[0]) + (parseFloat(style.columnGap) || 0), y: last.offsetTop }
}

function slideBy(el: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  el.style.transform = dx || dy ? `translate(${dx}px, ${dy}px)` : ''
}

// While a video that can join the Queue is lifted, VideoView turns its bar into a strip to drop
// it on (the Queue's end). drops counts drops into and out of the Queue: the list then skips its
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

// Side by side (VideoView's useSplitWidth): the Queue is a list of its own on the left, pinned, with
// its own scrollbar
const QUEUE_COLUMN = 'video-queue-column'

// Scrolls a box when the mouse is near its top or bottom edge (top: from there)
function edgeScroll(box: HTMLElement, pointerY: number, top = box.getBoundingClientRect().top) {
  const { bottom } = box.getBoundingClientRect()
  if (pointerY < top + EDGE) box.scrollTop -= SCROLL_STEP
  else if (pointerY > bottom - EDGE) box.scrollTop += SCROLL_STEP
}

// Press and drag a Queue row up or down to change its place, among its own group's rows
// (data-queue-group): the ones it passes slide one place to make room, like the Board's cards.
// With the mouse under the Queue's last row it leaves the Queue: dimmed, the others close up.
// Side by side, the Queue's own column scrolls, and the mouse over the right column also takes it out.
export function dragInQueue(event: ReactPointerEvent<HTMLElement>) {
  if (event.button !== 0 || event.pointerType !== 'mouse' || (event.target as HTMLElement).closest('.video-row-action')) return
  const row = event.currentTarget
  const list = row.closest<HTMLElement>('.video-list')
  const page = row.closest<HTMLElement>('.page')
  const rows = list ? [...list.querySelectorAll<HTMLElement>(`[data-queue-group="${row.dataset.queueGroup}"]`)] : []
  if (!list || !page) return

  const split = list.classList.contains(QUEUE_COLUMN)
  const index = rows.indexOf(row)
  const others = rows.filter((el) => el !== row)
  const grid = isGrid(list)
  const startX = event.clientX
  const startY = event.clientY
  const grab = startY - row.getBoundingClientRect().top
  const grabX = startX - row.getBoundingClientRect().left
  let pointerX = startX
  let pointerY = startY
  let started = false
  let frame = 0
  let place = index // how many of the others end up above it
  let out = false // under the Queue: leaves it

  // Each frame, as the page can scroll under a mouse that doesn't move. Places are measured in the
  // list's own pixels (offsetTop: no scroll, no transforms), the mouse in the screen's (zoom).
  function tick() {
    if (!row.isConnected) return end()
    edgeScroll(split ? list! : page!, pointerY)
    row.style.transform = ''
    const { top, left } = row.getBoundingClientRect()
    const dy = (pointerY - grab - top) / currentZoom()
    const dx = grid ? (pointerX - grabX - left) / currentZoom() : 0
    const at = listPoint(row, pointerX, pointerY)
    row.style.transform = `translate(${dx}px, ${dy}px)`
    const last = rows[rows.length - 1]
    out = at.y > last.offsetTop + last.offsetHeight || (split && pointerX > list!.getBoundingClientRect().right)
    row.classList.toggle('leaving', out)
    if (grid) place = tileBefore(others, at)
    else {
      // Its leading edge passing another row's middle swaps them
      const edge = row.offsetTop + dy + (dy > 0 ? row.offsetHeight : 0)
      place = others.findIndex((el) => edge < el.offsetTop + el.offsetHeight / 2)
    }
    if (place === -1) place = others.length
    // Each of the others to its place in the new order (out: they close up behind it)
    others.forEach((el, k) => {
      const now = k < index ? k : k + 1
      const next = out || k < place ? k : k + 1
      slideBy(el, slotOf(rows, now, list!), slotOf(rows, next, list!))
    })
    frame = requestAnimationFrame(tick)
  }

  const move = (e: PointerEvent) => {
    pointerX = e.clientX
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
// the list sideways is fine (a grid's tile follows the mouse sideways too: isGrid). from = the folder it's in (null: none). queue: it can go into the Queue
// too (dragVideo): over its videos they open a gap where it would go; over its folded row or the
// bar's strip, that lights up like a folder (it goes at the end).
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

  // Side by side, from the right column: the Queue is the list on the left, its gap opens there,
  // and the row follows the mouse sideways to reach it
  const queueList = queue ? page.querySelector<HTMLElement>(`.${QUEUE_COLUMN}`) : null
  const across = !!queueList && queueList !== list
  const gapList: HTMLElement = (across && queueList) || list
  const lists = across ? [list, gapList] : [list]
  const grid = isGrid(list)
  const startX = event.clientX
  const startY = event.clientY
  const grab = startY - row.getBoundingClientRect().top
  const grabX = startX - row.getBoundingClientRect().left
  let pointerX = startX
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
  // in the list's own pixels: the Queue's row itself when folded, else before the video
  // whose middle is under the mouse (over the Queue's row: first; a little under the last: last).
  // Across (the mouse over the Queue's column): anywhere in it, measured from the Queue's row.
  function queueSpot(point: { x: number; y: number }): QueueSpot | null {
    const head = gapList.querySelector<HTMLElement>('[data-queue-head]')
    if (!queue || !head) return null
    const at = across ? listPoint(head, pointerX, pointerY).y : point.y
    const rows = [...gapList.querySelectorAll<HTMLElement>('[data-queue-group]')]
    const last = rows[rows.length - 1]
    if (head.classList.contains('folded') || !last) return across || (at >= head.offsetTop && at < head.offsetTop + head.offsetHeight) ? { head } : null
    if (!across && (at < head.offsetTop || at > last.offsetTop + last.offsetHeight + head.offsetHeight / 2)) return null
    // Grid: before the tile it's over, in reading order
    const place = grid ? tileBefore(rows, point) : rows.findIndex((el) => at < el.offsetTop + el.offsetHeight / 2)
    return { rows, place: place === -1 ? rows.length : place }
  }

  // The gap: the rows from there move down by its height, down to its own place when it leaves it
  // (they close up behind it), all of them when it stays (a copy joins the Queue). Across, the
  // Queue's rows from there all move down, and when it leaves its place, the rows under it in the
  // right column close up.
  function openGap(next: QueueSpot | null) {
    const items = [...gapList.children] as HTMLElement[]
    const at = !next || 'head' in next ? -1 : next.place < next.rows.length ? items.indexOf(next.rows[next.place]) : items.indexOf(next.rows[next.rows.length - 1]) + 1
    if (at === gapAt) return
    gapAt = at
    const own = items.indexOf(row) // -1: across
    if (grid) return gridGap(items, next && 'rows' in next ? next : null)
    items.forEach((el, k) => {
      if (el === row) return
      const by = at >= 0 && k >= at && (!queue!.leaves || own < 0 || k < own)
      el.style.transform = by ? `translateY(${row.offsetHeight}px)` : ''
    })
    if (!across || !queue!.leaves) return
    const mine = [...list!.children] as HTMLElement[]
    const from = mine.indexOf(row)
    mine.forEach((el, k) => k > from && (el.style.transform = at >= 0 ? `translateY(${-row.offsetHeight}px)` : ''))
  }

  // Grid: the Queue's tiles from there move one place on (the last may start a new line: then
  // everything under the Queue moves down a line). Its own place stays empty while it's lifted.
  function gridGap(items: HTMLElement[], next: { rows: HTMLElement[]; place: number } | null) {
    for (const el of items) if (el !== row) el.style.transform = ''
    if (!next) return
    const { rows, place } = next
    rows.forEach((el, j) => j >= place && slideBy(el, slotOf(rows, j, list!), slotOf(rows, j + 1, list!)))
    const last = rows[rows.length - 1]
    const end = slotOf(rows, rows.length, list!)
    if (end.y === last.offsetTop) return
    const down = end.y - last.offsetTop
    for (const el of items.slice(items.indexOf(last) + 1)) if (el !== row) el.style.transform = `translateY(${down}px)`
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
    // The bar's strip (VideoView) takes it to the Queue's end: no scrolling over it, the page
    // scrolls up just under it instead
    const strip = queue ? page!.querySelector<HTMLElement>('.video-queue-strip') : null
    const onStrip = !!strip && pointerY < strip.getBoundingClientRect().bottom
    // Across: over the Queue's column once past the middle of the gap between the columns; it
    // scrolls that column instead of the page
    const overQueue = across && !onStrip && pointerX < (queueList!.getBoundingClientRect().right + list!.getBoundingClientRect().left) / 2
    if (overQueue) edgeScroll(queueList!, pointerY)
    else if (!onStrip) edgeScroll(page!, pointerY, strip ? strip.getBoundingClientRect().bottom : undefined)
    row.style.transform = ''
    const { top, left } = row.getBoundingClientRect()
    const at = listPoint(row, pointerX, pointerY)
    const dx = grid || across ? (pointerX - grabX - left) / currentZoom() : 0
    row.style.transform = `translate(${dx}px, ${(pointerY - grab - top) / currentZoom()}px)`
    spot = onStrip ? { head: strip } : across && !overQueue ? null : queueSpot(at)
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
    pointerX = e.clientX
    pointerY = e.clientY
    if (started || Math.hypot(e.clientX - startX, e.clientY - startY) < 4) return
    started = true
    row.classList.add('lifted')
    for (const el of lists) el.classList.add('dragging', 'reordering')
    // The bar's strip shows at once, to be measured
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
    for (const el of lists) el.classList.remove('dragging')
    row.style.transform = ''
    if (into) {
      // Drawn in the Queue at once, then the gap goes without sliding (already in place)
      const id = (el: HTMLElement | undefined) => el?.dataset.queueId ?? null
      flushSync(() => {
        if ('head' in into) placeInQueue(queue!.id, null, null)
        else placeInQueue(queue!.id, id(into.rows[into.place]), id(into.rows[into.place - 1]))
        changed({ lifted: false, dropped: true })
      })
      for (const el of lists) {
        el.classList.add('settling')
        for (const item of el.children) (item as HTMLElement).style.transform = ''
      }
      requestAnimationFrame(() => lists.forEach((el) => el.classList.remove('settling', 'reordering')))
      return
    }
    openGap(null)
    if (queue) changed({ lifted: false })
    window.setTimeout(() => lists.forEach((el) => el.classList.remove('reordering')), 200)
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

// To watch's top level (user, 2026-11-28, mockup video-section-order.html): a section's header, or a
// folder or playlist at the top (data-top), pressed and dragged to another place among the others.
// Its whole part (header and what's under it, up to the next data-top) stays as a faint copy, a copy
// of the header follows the mouse, a blue line shows where it lands. order: the whole order (with
// what's hidden), saved with it moved. into: a playlist can also go into a folder, dropped onto its
// row (a header at the top: on its middle half, else the line).
export function dragTop(event: ReactPointerEvent<HTMLElement>, key: string, order: string[], into?: {
  from: string | null
  move: (folderId: string) => Promise<void>
  open: (id: string) => void
}) {
  if (event.button !== 0 || event.pointerType !== 'mouse' || (event.target as HTMLElement).closest('.video-row-action')) return
  const row = event.currentTarget
  const page = row.closest<HTMLElement>('.page')
  if (!page) return
  const heads = [...page.querySelectorAll<HTMLElement>('[data-top]')]
  const own = heads.indexOf(row)
  const lists = [...new Set(heads.map((el) => el.parentElement as HTMLElement))]
  const split = lists.length > 1
  const startX = event.clientX
  const startY = event.clientY
  let pointerX = startX
  let pointerY = startY
  let started = false
  let frame = 0
  let openTimer = 0
  let over: HTMLElement | null = null
  let place = -1 // the head it goes before (heads.length: after them all; -1: nowhere new)
  let copy: HTMLElement | null = null
  let line: HTMLElement | null = null

  // A part's rows: its head, then the rows after it up to the next head
  function partOf(head: HTMLElement) {
    const rows = [head]
    for (let el = head.nextElementSibling as HTMLElement | null; el && el.dataset.top === undefined; el = el.nextElementSibling as HTMLElement | null) rows.push(el)
    return rows
  }
  const ghost = partOf(row)

  // The places between the parts in the list under the mouse, and the nearest (side by side: the
  // Queue's column holds before and after the Queue). Screen pixels.
  function nearestPlace() {
    const distance = (el: HTMLElement) => {
      const { left, right } = el.getBoundingClientRect()
      return pointerX < left ? left - pointerX : pointerX > right ? pointerX - right : 0
    }
    const list = lists.reduce((best, el) => (distance(el) < distance(best) ? el : best), lists[0])
    const inList = heads.filter((el) => el.parentElement === list)
    if (!inList.length) return null
    const spots = inList.map((head) => {
      const prev = head.previousElementSibling as HTMLElement | null
      const top = head.getBoundingClientRect().top
      return { place: heads.indexOf(head), y: prev ? (prev.getBoundingClientRect().bottom + top) / 2 : top - 3 * currentZoom() }
    })
    const last = list.lastElementChild as HTMLElement
    spots.push({ place: heads.indexOf(inList[inList.length - 1]) + 1, y: last.getBoundingClientRect().bottom + 2 * currentZoom() })
    const spot = spots.reduce((best, s) => (Math.abs(s.y - pointerY) < Math.abs(best.y - pointerY) ? s : best))
    return { ...spot, list }
  }

  const accepts = (el: HTMLElement) => !!into && el.dataset.dropChannel === '' && !!el.dataset.dropFolder && el.dataset.dropFolder !== into.from && !ghost.includes(el)

  // A playlist over a folder's row: into it (a head at the top: only on its middle half)
  function folderUnder() {
    const under = document.elementFromPoint(pointerX, pointerY)?.closest<HTMLElement>('[data-drop-channel]')
    if (!under || !accepts(under)) return null
    if (under.dataset.top === undefined) return under
    const { top, height } = under.getBoundingClientRect()
    return pointerY > top + height / 4 && pointerY < top + (height * 3) / 4 ? under : null
  }

  function setOver(el: HTMLElement | null) {
    if (el !== over) {
      over?.classList.remove('drop-into')
      window.clearTimeout(openTimer)
      over = el
      if (el?.classList.contains('folded')) openTimer = window.setTimeout(() => into?.open(el.dataset.open!), OPEN_AFTER_MS)
    }
    // Again each time: opening rewrites the row's classes
    over?.classList.add('drop-into')
  }

  function tick() {
    if (!row.isConnected) return end()
    edgeScroll(page!, pointerY)
    const zoom = currentZoom()
    // Side by side it follows the mouse sideways too, to reach the other column
    const dx = split ? (pointerX - startX) / zoom : 0
    copy!.style.transform = `translate(${dx}px, ${(pointerY - startY) / zoom}px)`
    const folder = folderUnder()
    setOver(folder)
    const spot = folder ? null : nearestPlace()
    // Its own place (before or just after itself) changes nothing: no line
    place = spot && spot.place !== own && spot.place !== own + 1 ? spot.place : -1
    line!.hidden = place < 0
    if (spot && place >= 0) {
      const { left, width } = spot.list.getBoundingClientRect()
      line!.style.left = `${left / zoom + 6}px`
      line!.style.width = `${width / zoom - 12}px`
      line!.style.top = `${spot.y / zoom - 1}px`
    }
    frame = requestAnimationFrame(tick)
  }

  // The copy in a list of its own, so the list's looks apply; fixed, so it stays under the mouse as
  // the page scrolls
  function lift() {
    const zoom = currentZoom()
    const box = row.getBoundingClientRect()
    const holder = document.createElement('ul')
    holder.className = `${(row.parentElement as HTMLElement).className} video-top-copy`
    Object.assign(holder.style, { left: `${box.left / zoom}px`, top: `${box.top / zoom}px`, width: `${box.width / zoom}px` })
    const li = row.cloneNode(true) as HTMLElement
    li.classList.remove('drop-into')
    li.classList.add('lifted')
    holder.append(li)
    copy = holder
    line = document.createElement('div')
    line.className = 'video-drop-line'
    line.hidden = true
    page!.append(holder, line)
    for (const el of ghost) el.classList.add('ghost')
    for (const el of lists) el.classList.add('dragging')
  }

  const move = (e: PointerEvent) => {
    pointerX = e.clientX
    pointerY = e.clientY
    if (started || Math.hypot(e.clientX - startX, e.clientY - startY) < 4) return
    started = true
    lift()
    tick()
  }
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && end()
  // The browser's own dragging (selected text, a folder's picture) would cancel this one
  const noNativeDrag = (e: DragEvent) => e.preventDefault()

  function end(e?: Event) {
    cancelAnimationFrame(frame)
    window.clearTimeout(openTimer)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('dragstart', noNativeDrag, true)
    if (!started) return
    // The click that ends a drag mustn't also open or fold it
    const swallow = (c: Event) => c.stopPropagation()
    window.addEventListener('click', swallow, { capture: true, once: true })
    window.setTimeout(() => window.removeEventListener('click', swallow, true), 0)
    const dropped = e?.type === 'pointerup'
    const target = dropped ? over : null
    setOver(null)
    if (dropped && !target && place >= 0) {
      // In the whole order: before the head it lands before, or just after the last one
      const before = heads[place]?.dataset.top
      const after = heads[place - 1]?.dataset.top
      const next = order.filter((k) => k !== key)
      const at = before !== undefined ? next.indexOf(before) : next.indexOf(after!) + 1
      next.splice(at < 0 ? next.length : at, 0, key)
      // Drawn in the new order at once; the list skips its animations (moved, not added)
      flushSync(() => {
        void saveSectionOrder(next)
        changed({ dropped: true })
      })
    }
    copy?.remove()
    line?.remove()
    for (const el of ghost) el.classList.remove('ghost')
    for (const el of lists) el.classList.remove('dragging')
    if (target) void into!.move(target.dataset.dropFolder!)
  }

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
  window.addEventListener('keydown', onKey)
  window.addEventListener('dragstart', noNativeDrag, true)
}
