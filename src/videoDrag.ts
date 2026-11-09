import type { PointerEvent as ReactPointerEvent } from 'react'
import { animationsOn, play, TIMING } from './animations'
import { currentZoom } from './appearance'
import { channelKey, type FeedVideo } from './video'
import { moveToFolder } from './videoFolders'

const OPEN_AFTER_MS = 600 // over a folded row this long: it opens, to reach what's inside
const EDGE = 30 // px from the page's top or bottom edge where it scrolls
const SCROLL_STEP = 8 // px per frame

// Press and drag a video row onto a folder (rows with data-drop-channel, see FoldRow in
// VideoView.tsx), or onto its channel's row to take it out of its folder. The row only moves up and
// down, like the Board's cards, and goes by the mouse's height, so leaving the list sideways is fine.
export function dragVideo(event: ReactPointerEvent<HTMLElement>, video: FeedVideo, open: (id: string) => void) {
  if (event.button !== 0 || event.pointerType !== 'mouse' || (event.target as HTMLElement).closest('.video-row-action')) return
  const row = event.currentTarget
  const list = row.closest<HTMLElement>('.video-list')
  const page = row.closest<HTMLElement>('.page')
  // No folder or channel row on screen (or one channel chosen): nowhere to go
  if (!list || !page || !list.querySelector('[data-drop-channel]')) return

  const key = channelKey(video)
  const startX = event.clientX
  const startY = event.clientY
  const grab = startY - row.getBoundingClientRect().top
  let pointerY = startY
  let started = false
  let frame = 0
  let openTimer = 0
  let over: HTMLElement | null = null

  const folderOf = (el: HTMLElement) => el.dataset.dropFolder || null
  const changesPlace = (el: HTMLElement) => folderOf(el) !== video.folderId

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
    row.style.transform = `translateY(${(pointerY - grab - row.getBoundingClientRect().top) / currentZoom()}px)`
    const { left, width } = list!.getBoundingClientRect()
    const under = document.elementFromPoint(left + width / 2, pointerY)?.closest<HTMLElement>('[data-drop-channel]')
    // Only your own folders, and this video's channel with its sub-folders
    setOver(under && (!under.dataset.dropChannel || under.dataset.dropChannel === key) ? under : null)
    frame = requestAnimationFrame(tick)
  }

  const move = (e: PointerEvent) => {
    pointerY = e.clientY
    if (started || Math.hypot(e.clientX - startX, e.clientY - startY) < 4) return
    started = true
    row.classList.add('lifted')
    list!.classList.add('dragging')
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
    setOver(null)
    row.classList.remove('lifted')
    list!.classList.remove('dragging')
    row.style.transform = ''
    if (e?.type === 'pointerup' && target && changesPlace(target)) void moveToFolder(video.id, folderOf(target))
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
