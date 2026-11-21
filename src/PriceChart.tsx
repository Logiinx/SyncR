import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from './i18n'
import { dayRange, shortDate, shortMonthName } from './dates'
import { FillSwitch } from './tabLines'
import { formatEuros, type GamePrices } from './prices'
import { discountText, usePriceHistory, type PriceChange } from './saleGuess'

// The game's Steam price over the last 2 years (IsThereAnyDeal, the sale guess's answer), drawn
// by hand under "Lowest ever" in the game window and the search preview (on a phone in the
// game window: a full-width row under the cover, like the sale table). A step line (gray, sales
// green with a light fill), scaled from 0 €; year lines labelled under it, month lines (names
// when they fit) once zoomed in. The line above it is its title, or the stretch under the mouse
// (lit up; a short one is caught from a few px): "12 Aug – 26 Aug 2026 · 14,99 € −50%", the
// last one "Since 12 Aug 2026 · …". Zoom: mouse wheel, drag moves, double-click goes back; the
// 2 y · 1 y · 6 m · 3 m switch; phone: one finger reads (it stays after lifting), two pinch and
// move. Opens on the last year each time (nothing remembered). No change in 2 years: nothing.

const DAY = 24 * 60 * 60 * 1000
const SPAN = 2 * 365 * DAY // all of it (the proxy asks IsThereAnyDeal for 2 years)
const MIN_SPAN = 30 * DAY
const START_DAYS = 365
const HEIGHT = 56
const PAD = 2 // above and below the line, so it isn't cut
const MONTH_LINES = 14 // px per month at least, for their lines
const MONTH_NAMES = 30 // … and for their names
const LABEL_ROOM = 14 // a mark's name this close to an edge would be cut: left out
const CATCH = 8 // px: a stretch narrower than this (a 3-day sale over 2 years) is caught this wide
const LIT = 4 // px: the light behind the picked stretch, at least

const RANGES = [
  { days: 730, label: () => t('2 y'), title: () => t('Steam price, last 2 years') },
  { days: 365, label: () => t('1 y'), title: () => t('Steam price, last year') },
  { days: 182, label: () => t('6 m'), title: () => t('Steam price, last 6 months') },
  { days: 91, label: () => t('3 m'), title: () => t('Steam price, last 3 months') },
]

interface View {
  start: number
  end: number
}
interface Stretch {
  start: number
  end: number
  price: number // cents
  cut: number // %
}

export function PriceHistory({ prices, place }: { prices: GamePrices; place: 'title' | 'row' }) {
  const history = usePriceHistory(prices)
  if (!history || history.length === 0) return null
  return <PriceChart history={history} className={`price-chart in-${place}`} />
}

// Kept within the 2 years, never narrower than a month
function fit(view: View, now: number): View {
  const span = Math.min(SPAN, Math.max(MIN_SPAN, view.end - view.start))
  const start = Math.min(Math.max(view.start, now - SPAN), now - span)
  return { start, end: start + span }
}

function PriceChart({ history, className }: { history: PriceChange[]; className: string }) {
  const [now] = useState(() => Date.now())
  const [view, setView] = useState<View>(() => ({ start: now - START_DAYS * DAY, end: now }))
  const [at, setAt] = useState<number | null>(null) // the time under the mouse or finger
  const [width, setWidth] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const viewRef = useRef(view)
  viewRef.current = view

  const stretches = useMemo<Stretch[]>(
    () => history.map((change, i) => ({ start: change.at, end: history[i + 1]?.at ?? now, price: change.price, cut: change.cut })),
    [history, now],
  )
  // (a change without its normal price counts only its price, so the scale never breaks)
  const top = Math.max(1, ...history.map((change) => Math.max(change.price, Number.isFinite(change.regular) ? change.regular : 0)))

  // Its width in CSS pixels (the drawing's own units, so lines and text stay sharp)
  useEffect(() => {
    const element = box.current!
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // The time at a screen x (a share of the box: the same under the app's zoom)
  const timeAt = (clientX: number, from = viewRef.current) => {
    const rect = box.current!.getBoundingClientRect()
    const share = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return from.start + share * (from.end - from.start)
  }

  // Mouse wheel: zooms around the mouse (React's wheel events can't stop the window scrolling)
  useEffect(() => {
    const element = box.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const time = timeAt(e.clientX)
      const k = Math.exp(e.deltaY * 0.002)
      const { start, end } = viewRef.current
      // Kept at once: the next turn of the wheel may come before it's drawn
      viewRef.current = fit({ start: time - (time - start) * k, end: time + (end - time) * k }, now)
      setView(viewRef.current)
      setAt(time)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [now])

  // Mouse drag moves; fingers: one reads, two pinch (zoom) and move
  const drag = useRef<{ x: number; view: View; moved: boolean } | null>(null)
  const fingers = useRef(new Map<number, number>()) // pointer id → clientX
  const pinch = useRef<{ time: number; gap: number; view: View } | null>(null)
  const startPinch = () => {
    const [a, b] = [...fingers.current.values()]
    pinch.current = { time: timeAt((a + b) / 2), gap: Math.max(1, Math.abs(a - b)), view: viewRef.current }
  }
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') {
      if (e.button !== 0) return
      drag.current = { x: e.clientX, view: viewRef.current, moved: false }
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    fingers.current.set(e.pointerId, e.clientX) // (a finger already stays with what it touched)
    if (fingers.current.size === 2) startPinch()
    else if (fingers.current.size === 1) setAt(timeAt(e.clientX))
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') {
      const dragged = drag.current
      if (dragged && (dragged.moved || Math.abs(e.clientX - dragged.x) > 3)) {
        dragged.moved = true
        const rect = box.current!.getBoundingClientRect()
        const shift = ((e.clientX - dragged.x) / rect.width) * (dragged.view.end - dragged.view.start)
        setView(fit({ start: dragged.view.start - shift, end: dragged.view.end - shift }, now))
        setAt(null)
      } else setAt(timeAt(e.clientX))
      return
    }
    if (!fingers.current.has(e.pointerId)) return
    fingers.current.set(e.pointerId, e.clientX)
    const pinched = pinch.current
    if (pinched && fingers.current.size === 2) {
      const [a, b] = [...fingers.current.values()]
      const span = (pinched.view.end - pinched.view.start) * (pinched.gap / Math.max(1, Math.abs(a - b)))
      const rect = box.current!.getBoundingClientRect()
      const share = Math.min(1, Math.max(0, ((a + b) / 2 - rect.left) / rect.width))
      setView(fit({ start: pinched.time - share * span, end: pinched.time + (1 - share) * span }, now))
    } else if (fingers.current.size === 1) setAt(timeAt(e.clientX))
  }
  const onPointerEnd = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') {
      drag.current = null
      return
    }
    fingers.current.delete(e.pointerId)
    pinch.current = null
  }

  const span = view.end - view.start
  const preset = RANGES.find((range) => view.end >= now - 1 && Math.abs(span - range.days * DAY) < DAY)
  const x = (time: number) => ((time - view.start) / span) * width
  const y = (price: number) => PAD + (1 - price / top) * (HEIGHT - 2 * PAD)

  // The stretch under the mouse: the one it's in, unless a short one is that close (then the
  // closest short one); before the first change, the first (nothing is known there)
  const pick = (time: number) => {
    const mouse = x(time)
    let best: Stretch | null = null
    let bestGap = CATCH / 2
    for (const stretch of stretches) {
      const left = x(stretch.start)
      const right = x(stretch.end)
      const gap = Math.abs(mouse - (left + right) / 2)
      if (right - left < CATCH && gap <= bestGap) [best, bestGap] = [stretch, gap]
    }
    return best ?? stretches.findLast((stretch) => stretch.start <= time) ?? stretches[0]
  }
  // Only while that time is in view (a finger's reading stays, but the view may change after it)
  const read = at !== null && at >= view.start && at <= view.end ? pick(at) : null
  const lastRead = read === stretches[stretches.length - 1]
  const lit = read && { left: x(read.start), right: x(read.end) }
  if (lit && lit.right - lit.left < LIT) [lit.left, lit.right] = [(lit.left + lit.right - LIT) / 2, (lit.left + lit.right + LIT) / 2]

  // Month and year lines, from the first month start in view
  const marks: { x: number; year: boolean; name: string | null }[] = []
  const perMonth = width / (span / (30.44 * DAY))
  const first = new Date(view.start)
  for (let month = new Date(first.getFullYear(), first.getMonth() + 1, 1); month.getTime() < view.end; month = new Date(month.getFullYear(), month.getMonth() + 1, 1)) {
    const year = month.getMonth() === 0
    if (!year && perMonth < MONTH_LINES) continue
    const left = x(month.getTime())
    const named = (year || perMonth >= MONTH_NAMES) && left >= LABEL_ROOM && left <= width - LABEL_ROOM
    marks.push({ x: left, year, name: named ? (year ? String(month.getFullYear()) : shortMonthName(month)) : null })
  }

  // The step line, then the sales over it in green
  const path = stretches.map((stretch, i) => `${i ? 'V' : `M${x(stretch.start)} `}${y(stretch.price)} H${x(stretch.end)}`).join(' ')
  const sales = stretches.filter((stretch) => stretch.cut > 0)

  return (
    <div className={className}>
      <div className="price-chart-head">
        {read ? (
          <span className="price-chart-read">
            <span className="sale-value">{lastRead ? t('Since {date}', { date: shortDate(read.start) }) : dayRange(read.start, read.end)}</span>
            {' · '}
            <span className="sale-value">{formatEuros(read.price)}</span>
            {read.cut > 0 ? <span className="sale-value discount"> {discountText(read.cut)}</span> : ` · ${t('full price')}`}
          </span>
        ) : (
          <span className="price-chart-read">{preset ? preset.title() : `${shortDate(view.start)} – ${shortDate(view.end)}`}</span>
        )}
        <FillSwitch
          className="price-chart-ranges"
          options={RANGES.map((range) => ({ value: range.days, label: range.label(), title: range.title() }))}
          value={preset?.days ?? 0}
          onChange={(days) => setView({ start: now - days * DAY, end: now })}
          label={t('Price history range')}
        />
      </div>
      <div
        ref={box}
        className="price-chart-box"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onPointerLeave={(e) => e.pointerType === 'mouse' && !drag.current && setAt(null)}
        onDoubleClick={() => setView({ start: now - START_DAYS * DAY, end: now })}
      >
        {width > 0 && (
          <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label={t('Steam price history')}>
            {marks.map((mark) => (
              <line key={mark.x} className={mark.year ? 'price-chart-year' : 'price-chart-month'} x1={mark.x} x2={mark.x} y1={0} y2={HEIGHT} />
            ))}
            {lit && <rect className="price-chart-lit" x={lit.left} y={0} width={lit.right - lit.left} height={HEIGHT} />}
            {sales.map((sale) => (
              <rect key={sale.start} className="price-chart-sale-fill" x={x(sale.start)} y={y(sale.price)} width={x(sale.end) - x(sale.start)} height={HEIGHT - y(sale.price)} />
            ))}
            <path className="price-chart-line" d={path} />
            {sales.map((sale) => (
              <line key={sale.start} className="price-chart-sale" x1={x(sale.start)} x2={x(sale.end)} y1={y(sale.price)} y2={y(sale.price)} />
            ))}
            {lit && <line className={read.cut > 0 ? 'price-chart-picked discount' : 'price-chart-picked'} x1={lit.left} x2={lit.right} y1={y(read.price)} y2={y(read.price)} />}
          </svg>
        )}
      </div>
      <div className="price-chart-marks">
        {marks.map(
          (mark) =>
            mark.name && (
              <span key={mark.x} className={mark.year ? 'year' : undefined} style={{ left: mark.x }}>
                {mark.name}
              </span>
            ),
        )}
      </div>
    </div>
  )
}
