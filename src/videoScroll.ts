import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { read, write } from './localState'

// The Video tab's scroll: one spot per list, kept on this PC, also after a restart (user,
// 2026-11-16). A spot is the row at the top of the page and how far it sat from there, so videos
// arriving above it or leaving don't move you; when that row is gone, the plain distance.
interface Spot {
  item: string // the row's data-item, '' when none
  offset: number // px from the page's top to the row's
  top: number // the page's scrollTop
}
const KEY = 'syncr.video.scroll'
const SAVE_AFTER = 300 // ms after the last scroll

const rowsIn = (page: HTMLElement) => page.querySelectorAll<HTMLElement>('.video-list [data-item]')

function spotOf(page: HTMLElement): Spot {
  const pageTop = page.getBoundingClientRect().top
  for (const row of rowsIn(page)) {
    const box = row.getBoundingClientRect()
    if (box.bottom > pageTop) return { item: row.dataset.item ?? '', offset: box.top - pageTop, top: page.scrollTop }
  }
  return { item: '', offset: 0, top: page.scrollTop }
}

// ready: the list's rows are there (put back only then). filter: the follows filter; changing it
// starts at the top.
export function useListScroll(pageRef: RefObject<HTMLElement | null>, list: string, ready: boolean, filter: string) {
  const shown = useRef(list) // the list the page shows
  const restoring = useRef(true) // its spot isn't back yet: nothing saved meanwhile
  const latest = useRef<{ list: string; spot: Spot } | null>(null) // measured, not saved yet
  const saveTimer = useRef(0)
  const lastFilter = useRef(filter)

  function save() {
    clearTimeout(saveTimer.current)
    saveTimer.current = 0
    if (!latest.current) return
    const all = read<Record<string, Spot>>(KEY, {})
    all[latest.current.list] = latest.current.spot
    write(KEY, all)
    latest.current = null
  }

  // Measured as you scroll (once a frame at most), saved a moment after; and when the tab closes
  useEffect(() => {
    const page = pageRef.current
    if (!page) return
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        if (restoring.current) return
        latest.current = { list: shown.current, spot: spotOf(page) }
        clearTimeout(saveTimer.current)
        saveTimer.current = window.setTimeout(save, SAVE_AFTER)
      })
    }
    page.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      page.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
      save()
    }
  }, [pageRef])

  // Another list: the old one's spot saved, the new one's put back once its rows are there
  useLayoutEffect(() => {
    const page = pageRef.current
    if (!page) return
    if (shown.current !== list) {
      save()
      shown.current = list
      restoring.current = true
    } else if (lastFilter.current !== filter && !restoring.current) {
      page.scrollTop = 0
    }
    lastFilter.current = filter
    if (!restoring.current || !ready) return
    restoring.current = false
    const spot = read<Record<string, Spot>>(KEY, {})[list]
    const row = spot?.item ? [...rowsIn(page)].find((one) => one.dataset.item === spot.item) : undefined
    if (row) page.scrollTop += row.getBoundingClientRect().top - page.getBoundingClientRect().top - spot!.offset
    else page.scrollTop = spot?.top ?? 0
  })
}
