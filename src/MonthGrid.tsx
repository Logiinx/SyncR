import type { MouseEvent, ReactNode } from 'react'
import { capitalize, locale } from './i18n'

// Month grids, stacked (used by the Games calendar and the Reminders tab): for each month a
// title with a count, a weekday header (Monday first) and one cell per day. A day with many
// items grows taller (the whole week row with it). Past days are dimmed, today is blue.

// Short day names, Monday first (1 January 2024 was a Monday)
const weekdays = () =>
  Array.from({ length: 7 }, (_, i) => new Date(2024, 0, i + 1).toLocaleDateString(locale(), { weekday: 'short' }))

export const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
export const monthTitle = (date: Date) => capitalize(date.toLocaleDateString(locale(), { month: 'long', year: 'numeric' }))

interface Props {
  months: Date[] // the first day of each month to show
  renderDay: (date: Date) => ReactNode // the items in a day's cell
  count: (first: Date) => number | null // the number next to the month's title (null: none)
  after?: (first: Date) => ReactNode // under a month's grid (e.g. games with only a month)
  // Left or right click on the empty part of today or a later day (Reminders: add an event)
  onDayClick?: (date: Date) => void
  onDayMenu?: (date: Date, x: number, y: number) => void
}

// A click on one of the day's items is that item's own
const onItem = (e: MouseEvent) => (e.target as Element).closest('button') !== null

function MonthGrid({ months, renderDay, count, after, onDayClick, onDayMenu }: Props) {
  const today = new Date()
  return months.map((first) => {
    const year = first.getFullYear()
    const month = first.getMonth()
    const days = new Date(year, month + 1, 0).getDate()
    const blanks = (first.getDay() + 6) % 7 // Monday first
    return (
      <section key={`${year}-${month}`} className="games-group calendar-month">
        <h3 className="games-group-title">
          {monthTitle(first)} <span className="games-count">{count(first)}</span>
        </h3>
        <div className="calendar-grid">
          {weekdays().map((day) => (
            <div key={day} className="calendar-weekday">
              {day}
            </div>
          ))}
          {Array.from({ length: blanks }, (_, i) => (
            <div key={`blank-${i}`} className="calendar-day blank" />
          ))}
          {Array.from({ length: days }, (_, i) => {
            const date = new Date(year, month, i + 1)
            const isToday = dayKey(date) === dayKey(today)
            const past = !isToday && date < today
            const addable = !past && onDayClick !== undefined
            return (
              <div
                key={i}
                className={`calendar-day${isToday ? ' today' : ''}${past ? ' past' : ''}${addable ? ' addable' : ''}`}
                onClick={addable ? (e) => !onItem(e) && onDayClick(date) : undefined}
                onContextMenu={
                  !past && onDayMenu
                    ? (e) => {
                        if (onItem(e)) return
                        e.preventDefault()
                        onDayMenu(date, e.clientX, e.clientY)
                      }
                    : undefined
                }
              >
                <span className="calendar-date">{i + 1}</span>
                {renderDay(date)}
              </div>
            )
          })}
        </div>
        {after?.(first)}
      </section>
    )
  })
}

// Groups items by day (dayKey), e.g. to look up a cell's items quickly
export function byDay<T>(items: T[], timeOf: (item: T) => number) {
  const days = new Map<string, T[]>()
  for (const item of items) {
    const key = dayKey(new Date(timeOf(item)))
    days.set(key, [...(days.get(key) ?? []), item])
  }
  return days
}

export const sameMonth = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()

export default MonthGrid
