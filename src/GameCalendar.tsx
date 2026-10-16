import { useEffect, useState } from 'react'
import { gameId, releaseCountdown, STATUSES } from './games'
import { CALENDAR_MONTHS, coverUrl, popularUpcoming, type UpcomingGame } from './igdb'
import type { GameStatus } from './db'
import Cover from './GameCover'
import { useNarrow } from './useNarrow'

// The Games tab's Calendar view: popular upcoming PC games for the next 6 months.
// PC: a month grid (Monday first) or a list, with a switch (GamesView.tsx). Phone: always the list.
// Grid: games with only a month ("Nov 2026") are listed under that month's grid. Games with only
// a quarter or a year ("Q1 2027", "2026") come last, in "No exact date yet" (in the list, all
// vague dates do). Click a game for a small popup.

export type CalendarLayout = 'grid' | 'list'

// Loaded once per app start (switching views doesn't ask IGDB again)
let cache: Promise<UpcomingGame[]> | null = null

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const monthTitle = (date: Date) => date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`

function GameCalendar({ inList, layout }: { inList: Map<string, GameStatus>; layout: CalendarLayout }) {
  const [games, setGames] = useState<UpcomingGame[] | null>(null)
  const [error, setError] = useState('')
  const [shown, setShown] = useState<UpcomingGame | null>(null) // the game in the popup
  const narrow = useNarrow()

  useEffect(() => {
    let current = true
    cache ??= popularUpcoming()
    cache.then(
      (found) => current && setGames(found),
      (e) => {
        cache = null // try again next time
        if (current) setError(e instanceof Error ? e.message : String(e))
      },
    )
    return () => {
      current = false
    }
  }, [])

  if (error) return <p className="game-search-message error">{error}</p>
  if (!games) return <p className="game-search-message">Loading upcoming games…</p>
  if (games.length === 0) return <p className="game-search-message">No upcoming games found.</p>

  const statusOf = (game: UpcomingGame) => inList.get(gameId(game.igdbId))
  const grid = layout === 'grid' && !narrow
  const vague = games.filter((g) => !g.exact && !(grid && g.monthOnly))
  return (
    <div className="game-calendar">
      {grid ? (
        <CalendarGrid games={games} statusOf={statusOf} onShow={setShown} />
      ) : (
        <CalendarList games={games.filter((g) => g.exact)} statusOf={statusOf} onShow={setShown} />
      )}
      {vague.length > 0 && (
        <CalendarGroup title="No exact date yet" games={vague} statusOf={statusOf} onShow={setShown} />
      )}
      {shown && <CalendarPopup game={shown} status={statusOf(shown)} onClose={() => setShown(null)} />}
    </div>
  )
}

type ShowGame = (game: UpcomingGame) => void
type StatusOf = (game: UpcomingGame) => GameStatus | undefined

// List: one group per month
function CalendarList({ games, statusOf, onShow }: { games: UpcomingGame[]; statusOf: StatusOf; onShow: ShowGame }) {
  const months = new Map<string, UpcomingGame[]>()
  for (const game of games) {
    const month = monthTitle(new Date(game.pcDate))
    months.set(month, [...(months.get(month) ?? []), game])
  }
  return (
    <>
      {[...months].map(([title, group]) => (
        <CalendarGroup key={title} title={title} games={group} statusOf={statusOf} onShow={onShow} />
      ))}
    </>
  )
}

function CalendarGroup(props: { title: string; games: UpcomingGame[]; statusOf: StatusOf; onShow: ShowGame }) {
  return (
    <section className="games-group">
      <h3 className="games-group-title">
        {props.title} <span className="games-count">{props.games.length}</span>
      </h3>
      <CalendarRows games={props.games} statusOf={props.statusOf} onShow={props.onShow} />
    </section>
  )
}

function CalendarRows({ games, statusOf, onShow }: { games: UpcomingGame[]; statusOf: StatusOf; onShow: ShowGame }) {
  const label = (status?: GameStatus) => STATUSES.find((s) => s.status === status)?.label
  return games.map((game) => {
    const status = statusOf(game)
    return (
      <div key={game.igdbId} className="game-row calendar-row" onClick={() => onShow(game)}>
        <Cover coverId={game.coverId} />
        <div className="game-text">
          <div className="game-name">{game.name}</div>
          <div className="game-details">{releaseText(game)}</div>
        </div>
        {status && <span className="game-in-list">In {label(status)}</span>}
      </div>
    )
  })
}

// "Thu 29 Oct · in 13 days", or IGDB's text for a vague date ("Q1 2027")
function releaseText(game: UpcomingGame, withYear = false) {
  if (!game.exact) return game.vagueLabel
  const date = new Date(game.pcDate).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(withYear && { year: 'numeric' }),
  })
  return `${date} · ${releaseCountdown(game.pcDate)}`
}

// Grid: every month from this one to the end of the range, stacked. Each month: weekday header,
// day cells (a day with many games grows taller), then its month-only games.
function CalendarGrid({ games, statusOf, onShow }: { games: UpcomingGame[]; statusOf: StatusOf; onShow: ShowGame }) {
  const today = new Date()
  const byDay = new Map<string, UpcomingGame[]>()
  for (const game of games.filter((g) => g.exact)) {
    const key = dayKey(new Date(game.pcDate))
    byDay.set(key, [...(byDay.get(key) ?? []), game])
  }
  // The range ends 6 months from today, so it usually ends partway through a 7th month
  const end = new Date(today.getFullYear(), today.getMonth() + CALENDAR_MONTHS, today.getDate())
  const months = Array.from({ length: CALENDAR_MONTHS + 1 }, (_, i) => new Date(today.getFullYear(), today.getMonth() + i, 1))
    .filter((first) => first < end)

  return months.map((first) => {
    const year = first.getFullYear()
    const month = first.getMonth()
    const days = new Date(year, month + 1, 0).getDate()
    const blanks = (first.getDay() + 6) % 7 // Monday first
    const monthOnly = games.filter((g) => g.monthOnly && sameMonth(new Date(g.pcDate), first))
    const count = [...byDay.keys()].filter((k) => k.startsWith(`${year}-${month}-`)).reduce((n, k) => n + byDay.get(k)!.length, 0)
    return (
      <section key={`${year}-${month}`} className="games-group calendar-month">
        <h3 className="games-group-title">
          {monthTitle(first)} <span className="games-count">{count + monthOnly.length}</span>
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
                {(byDay.get(dayKey(date)) ?? []).map((game) => (
                  <button key={game.igdbId} className="calendar-game" onClick={() => onShow(game)} title={game.name}>
                    <Cover coverId={game.coverId} />
                    <span>{game.name}</span>
                  </button>
                ))}
              </div>
            )
          })}
        </div>
        {monthOnly.length > 0 && (
          <div className="calendar-month-only">
            <p>Sometime in {first.toLocaleDateString('en-GB', { month: 'long' })}</p>
            <CalendarRows games={monthOnly} statusOf={statusOf} onShow={onShow} />
          </div>
        )}
      </section>
    )
  })
}

const sameMonth = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()

// Small popup: cover, name, release, all platforms, and where it is in your list
function CalendarPopup({ game, status, onClose }: { game: UpcomingGame; status?: GameStatus; onClose: () => void }) {
  const label = STATUSES.find((s) => s.status === status)?.label
  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        className="dialog game-dialog calendar-popup"
        role="dialog"
        aria-label={game.name}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <div className="game-dialog-head">
          {game.coverId && <img className="game-dialog-cover" src={coverUrl(game.coverId, 'cover_big')} alt="" />}
          <div>
            <h2>{game.name}</h2>
            <p className="game-dialog-info">{releaseText(game, true)}</p>
            {game.platforms.length > 0 && <p className="game-dialog-info">{game.platforms.join(', ')}</p>}
            {label && <p className="game-dialog-info">In your list: {label}</p>}
          </div>
        </div>
        <div className="dialog-buttons">
          <button className="primary" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default GameCalendar
