import { useEffect, useState } from 'react'
import { Pin } from 'lucide-react'
import { addGame, gameId, releaseText, STATUSES } from './games'
import { CALENDAR_MONTHS, popularUpcoming, type UpcomingGame } from './igdb'
import type { GameStatus } from './db'
import Cover from './GameCover'
import GamePreview from './GamePreview'
import MonthGrid, { byDay, dayKey, monthTitle, sameMonth } from './MonthGrid'
import { useNarrow } from './useNarrow'
import Spinner from './Spinner'

// The Games tab's Calendar view: popular upcoming PC games for the next 6 months (Steam's top
// 100 / 300 / 500 / 1000 most wishlisted, chosen with buttons).
// PC: a month grid (Monday first) or a list, with a switch (GamesView.tsx). Phone: always the list.
// Grid: games with only a month ("Nov 2026") are listed under that month's grid. Games with only
// a quarter or a year ("Q1 2027", "2026") come last, in "No exact date yet" (in the list, all
// vague dates do). Click a game for a small popup (GamePreview.tsx). The pin (rows, popup) adds
// a game to Waiting; games already in your list show where they are instead (grid: a blue tint).

export type CalendarLayout = 'grid' | 'list'

// How many of Steam's most wishlisted upcoming games to show (buttons in GamesView.tsx)
export const TOP_LEVELS = [100, 300, 500, 1000]
export const DEFAULT_TOP = 500

// Loaded once per app start (switching views doesn't ask IGDB again)
let cache: Promise<UpcomingGame[]> | null = null

function GameCalendar(props: { inList: Map<string, GameStatus>; layout: CalendarLayout; top: number }) {
  const { inList, layout, top } = props
  const [loaded, setLoaded] = useState<UpcomingGame[] | null>(null) // Steam's top 1000
  const [error, setError] = useState('')
  const [shown, setShown] = useState<UpcomingGame | null>(null) // the game in the popup
  const narrow = useNarrow()

  useEffect(() => {
    let current = true
    cache ??= popularUpcoming()
    cache.then(
      (found) => current && setLoaded(found),
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
  if (!loaded) {
    return (
      <p className="game-search-message loading-line">
        <Spinner /> Loading upcoming games…
      </p>
    )
  }
  const games = loaded.filter((g) => g.rank <= top) // the chosen level (top 100 / 300 / 500 / 1000)
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
      {shown && (
        <GamePreview game={shown} release={releaseLine(shown)} status={statusOf(shown)} onClose={() => setShown(null)} />
      )}
    </div>
  )
}

type ShowGame = (game: UpcomingGame) => void
type StatusOf = (game: UpcomingGame) => GameStatus | undefined

// Pin: add the game to Waiting. Only the list's own fields are saved (not rank etc.). Its release
// date follows the usual rule (PC first); a vague date keeps its label ("Q1 2027") and sorts last.
function pin(game: UpcomingGame) {
  const { igdbId, name, coverId, platforms, releaseDate, releaseLabel } = game
  addGame({ igdbId, name, coverId, platforms, releaseDate, releaseLabel }, 'waiting')
}

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
          <div className="game-name" title={game.name}>{game.name}</div>
          <div className="game-details">{releaseLine(game)}</div>
        </div>
        {status ? (
          <span className="game-in-list">In {label(status)}</span>
        ) : (
          <button
            className="calendar-pin"
            title="Add to Waiting"
            onClick={(e) => {
              e.stopPropagation() // not the popup
              pin(game)
            }}
          >
            <Pin size={15} />
          </button>
        )}
      </div>
    )
  })
}

// The release line like everywhere else (games.ts), from the calendar's PC date: "29 Oct 2026 · in 7 days",
// or IGDB's text for a vague date ("Q1 2027")
const releaseLine = (game: UpcomingGame) =>
  releaseText({ releaseDate: game.exact ? game.pcDate : undefined, releaseLabel: game.vagueLabel }, 'full')

// Grid: every month from this one to the end of the range, stacked (MonthGrid.tsx). A day shows
// its games' covers and names; a month's month-only games are listed under its grid.
function CalendarGrid({ games, statusOf, onShow }: { games: UpcomingGame[]; statusOf: StatusOf; onShow: ShowGame }) {
  const today = new Date()
  const days = byDay(
    games.filter((g) => g.exact),
    (g) => g.pcDate,
  )
  // The range ends 6 months from today, so it usually ends partway through a 7th month
  const end = new Date(today.getFullYear(), today.getMonth() + CALENDAR_MONTHS, today.getDate())
  const months = Array.from({ length: CALENDAR_MONTHS + 1 }, (_, i) => new Date(today.getFullYear(), today.getMonth() + i, 1))
    .filter((first) => first < end)
  const monthOnly = (first: Date) => games.filter((g) => g.monthOnly && sameMonth(new Date(g.pcDate), first))

  return (
    <MonthGrid
      months={months}
      count={(first) => games.filter((g) => (g.exact || g.monthOnly) && sameMonth(new Date(g.pcDate), first)).length}
      renderDay={(date) =>
        (days.get(dayKey(date)) ?? []).map((game) => (
          <button
            key={game.igdbId}
            className={statusOf(game) ? 'calendar-game in-list' : 'calendar-game'}
            onClick={() => onShow(game)}
            title={game.name}
          >
            <Cover coverId={game.coverId} />
            <span>{game.name}</span>
          </button>
        ))
      }
      after={(first) =>
        monthOnly(first).length > 0 && (
          <div className="calendar-month-only">
            <p>Sometime in {first.toLocaleDateString('en-GB', { month: 'long' })}</p>
            <CalendarRows games={monthOnly(first)} statusOf={statusOf} onShow={onShow} />
          </div>
        )
      }
    />
  )
}

export default GameCalendar
