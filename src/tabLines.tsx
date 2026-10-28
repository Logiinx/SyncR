import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { currentZoom } from './appearance'
import { animationsOn } from './animations'

// Tab rows (note tabs, Games' status tabs): the open tab's blue line, and a faint one under
// the mouse, slide to their new tab instead of jumping. Each tab holds both lines (<TabLines />,
// shown by the tab's classes). While one slides, a copy of it moves over the row, following
// the new tab as it moves (tabs widen or narrow while their ✕ shows), and the tab's own line
// waits hidden until the copy arrives.
// Filled switches (My games | Calendar, grid / list…) do the same with the chosen button's blue
// fill (<TabLines fill />). Their copy moves inside the row, behind the buttons' text.

const SLIDE_MS = 200
const FADE_MS = 150

// Put inside each tab, in the element the line should be as wide as (position: relative)
export function TabLines({ fill = false }: { fill?: boolean }) {
  const className = fill ? 'tab-fill' : 'tab-line'
  return (
    <>
      <span className={`${className} ghost`} />
      <span className={className} />
    </>
  )
}

// row: the row of tabs. active: the open tab's key. Each tab gets tabProps(key) and the
// class "hovered" when its key is `hovered`. fill: a filled switch (<TabLines fill />).
export function useTabLines(row: RefObject<HTMLElement | null>, active: string | null, fill = false) {
  const [hovered, setHovered] = useState<string | null>(null)
  const kind = fill ? '.tab-fill' : '.tab-line'
  const find = (selector: string) => (key: string) =>
    row.current?.querySelector<HTMLElement>(`[data-line="${CSS.escape(key)}"] ${selector}`)
  useSlidingLine(row, active, find(`${kind}:not(.ghost)`), fill)
  useSlidingLine(row, hovered, find(`${kind}.ghost`), fill)
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

interface SwitchOption<T> {
  value: T
  label: ReactNode
  title?: string
}

// A filled switch: the chosen button is blue (My games | Calendar, Top 100…, grid / list).
// before: shown in the row before the buttons ("Top").
export function FillSwitch<T extends string | number>({
  className,
  options,
  value,
  onChange,
  before,
  title,
}: {
  className: string
  options: SwitchOption<T>[]
  value: T
  onChange: (value: T) => void
  before?: ReactNode
  title?: string
}) {
  const row = useRef<HTMLDivElement>(null)
  const lines = useTabLines(row, String(value), true)
  return (
    <div className={`${className} fill-switch`} ref={row} onPointerLeave={lines.onRowLeave} title={title}>
      {before}
      {options.map((option) => {
        let buttonClass = option.value === value ? 'active' : ''
        if (lines.hovered === String(option.value)) buttonClass += ' hovered'
        return (
          <button
            key={option.value}
            {...lines.tabProps(String(option.value))}
            className={buttonClass}
            onClick={() => onChange(option.value)}
            title={option.title}
          >
            <TabLines fill />
            {option.label}
          </button>
        )
      })}
    </div>
  )
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
  fill: boolean,
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

  // Screen pixels → the zoomed page's pixels (Settings → App → App scaling). A line: on the page,
  // never outside the row. A fill: inside the row (from its top left corner).
  function draw(s: Slide) {
    const zoom = currentZoom()
    const bounds = row.current?.getBoundingClientRect()
    let { left, top, width } = s.now
    if (fill && bounds) {
      left -= bounds.left
      top -= bounds.top
    } else if (bounds) {
      const right = Math.min(left + width, bounds.right)
      left = Math.max(left, bounds.left)
      width = right - left
    }
    const style = s.copy.style
    style.display = width > 0 ? '' : 'none'
    style.left = `${left / zoom}px`
    style.top = `${top / zoom}px`
    style.width = `${width / zoom}px`
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
    if (!from || !look || !row.current || !animationsOn()) return

    const copy = document.createElement('div')
    const { backgroundColor, borderRadius } = getComputedStyle(look)
    copy.className = fill ? 'tab-fill-copy' : 'tab-line-copy'
    copy.style.backgroundColor = backgroundColor
    copy.style.borderRadius = borderRadius
    if (fill) row.current.prepend(copy) // first: the buttons cover it
    else document.body.append(copy)
    target?.classList.add('sliding')
    const s: Slide = { copy, target, from, now: from, start: performance.now(), frame: 0 }
    slide.current = s
    draw(s)
    s.frame = requestAnimationFrame((time) => step(s, time))
  }, [key])

  useLayoutEffect(() => stop, [])
}
