import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { currentZoom } from './appearance'

// Tab rows (note tabs, Games' status tabs): the open tab's blue line, and a faint one under
// the mouse, slide to their new tab instead of jumping. Each tab holds both lines (<TabLines />,
// shown by the tab's classes). While one slides, a copy of it moves over the row, following
// the new tab as it moves (tabs widen or narrow while their ✕ shows), and the tab's own line
// waits hidden until the copy arrives.

const SLIDE_MS = 200
const FADE_MS = 150

// Settings → Animations (see appearance.ts)
export function animationsOn() {
  return !document.documentElement.classList.contains('no-animations')
}

// Put inside each tab, in the element the line should be as wide as (position: relative)
export function TabLines() {
  return (
    <>
      <span className="tab-line ghost" />
      <span className="tab-line" />
    </>
  )
}

// row: the row of tabs. active: the open tab's key. Each tab gets tabProps(key) and the
// class "hovered" when its key is `hovered`.
export function useTabLines(row: RefObject<HTMLElement | null>, active: string | null) {
  const [hovered, setHovered] = useState<string | null>(null)
  const find = (selector: string) => (key: string) =>
    row.current?.querySelector<HTMLElement>(`[data-line="${CSS.escape(key)}"] ${selector}`)
  useSlidingLine(row, active, find('.tab-line:not(.ghost)'))
  useSlidingLine(row, hovered, find('.tab-line.ghost'))
  return {
    hovered,
    // Only a mouse: a finger has no hover
    tabProps: (key: string) => ({
      'data-line': key,
      onPointerEnter: (e: React.PointerEvent) => e.pointerType === 'mouse' && setHovered(key),
    }),
    onRowLeave: () => setHovered(null),
  }
}

interface Box {
  left: number
  top: number
  width: number
  height: number
}

interface Slide {
  copy: HTMLElement
  target: HTMLElement | null // null: fading out where it was (the mouse left the row)
  from: Box
  now: Box
  start: number
  frame: number
}

function box(el: HTMLElement): Box {
  const { left, top, width, height } = el.getBoundingClientRect()
  return { left, top, width, height }
}

function mix(a: Box, b: Box, t: number): Box {
  const at = (x: number, y: number) => x + (y - x) * t
  return { left: at(a.left, b.left), top: at(a.top, b.top), width: at(a.width, b.width), height: at(a.height, b.height) }
}

// Moves one kind of line (open tab's, or the mouse's) when `key` changes
function useSlidingLine(
  row: RefObject<HTMLElement | null>,
  key: string | null,
  line: (key: string) => HTMLElement | null | undefined,
) {
  const last = useRef(key)
  const slide = useRef<Slide | null>(null)

  function stop() {
    const s = slide.current
    if (!s) return
    cancelAnimationFrame(s.frame)
    s.copy.remove()
    s.target?.classList.remove('sliding')
    slide.current = null
  }

  // Screen pixels → the zoomed page's pixels (Settings → App scaling); never outside the row
  function draw(s: Slide) {
    const zoom = currentZoom()
    const bounds = row.current?.getBoundingClientRect()
    const left = Math.max(s.now.left, bounds?.left ?? -Infinity)
    const right = Math.min(s.now.left + s.now.width, bounds?.right ?? Infinity)
    const style = s.copy.style
    style.display = right > left ? '' : 'none'
    style.left = `${left / zoom}px`
    style.top = `${s.now.top / zoom}px`
    style.width = `${(right - left) / zoom}px`
    style.height = `${s.now.height / zoom}px`
  }

  function step(s: Slide, time: number) {
    const t = Math.min(1, Math.max(0, (time - s.start) / (s.target ? SLIDE_MS : FADE_MS)))
    if (s.target) {
      if (!s.target.isConnected) return stop()
      const eased = 1 - (1 - t) ** 3 // fast, then slowing down
      s.now = mix(s.from, box(s.target), eased)
    } else s.copy.style.opacity = String(1 - t)
    draw(s)
    if (t < 1) s.frame = requestAnimationFrame((time) => step(s, time))
    else stop()
  }

  useLayoutEffect(() => {
    const prevKey = last.current
    last.current = key
    if (prevKey === key) return
    const target = (key && line(key)) || null
    const old = (prevKey && line(prevKey)) || null // gone if that tab was closed
    // From where the line is now: mid-slide, or on the old tab
    const running = slide.current
    const from = running ? running.now : old && box(old)
    const look = target ?? old
    stop()
    if (!from || !look || !animationsOn()) return

    const copy = document.createElement('div')
    const { backgroundColor, borderRadius } = getComputedStyle(look)
    copy.className = 'tab-line-copy'
    copy.style.backgroundColor = backgroundColor
    copy.style.borderRadius = borderRadius
    document.body.append(copy)
    target?.classList.add('sliding')
    const s: Slide = { copy, target, from, now: from, start: performance.now(), frame: 0 }
    slide.current = s
    draw(s)
    s.frame = requestAnimationFrame((time) => step(s, time))
  }, [key])

  useLayoutEffect(() => stop, [])
}
