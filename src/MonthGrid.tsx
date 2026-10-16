import type { ReactNode } from 'react'

// Month grids, stacked (used by the Games calendar and the Reminders tab): for each month a
// title with a count, a weekday header (Monday first) and one cell per day. A day with many
// items grows taller (the whole week row with it). Past days are dimmed, today is blue.

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
export const monthTitle = (date: Date) => date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

interface Props {
  months: Date[] // the first day of each month to show
  renderDay: (date: Date) => ReactNode // the items in a day's cell
  count: (first: Date) => number // the number next to the month's title
  after?: (first: Date) => ReactNode // under a month's grid (e.g. games with only a month)
}

function MonthGrid({ months, renderDay, count, after }: Props) {
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
          {WEEKDAYS.map((day) => (
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
            return (
              <div key={i} className={`calendar-day${isToday ? ' today' : ''}${past ? ' past' : ''}`}>
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
