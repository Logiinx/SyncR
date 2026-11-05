import { useEffect, useState } from 'react'
import { locale, t } from './i18n'
import { CalendarDays, List } from 'lucide-react'
import { addGame, gameId, releaseText, statusLabel, tabOf } from './games'
import { CALENDAR_MONTHS, popularUpcoming, type UpcomingGame } from './igdb'
import type { GameStatus } from './db'
import Cover from './GameCover'
import AddOrInList from './AddOrInList'
import GamePreview from './GamePreview'
import MonthGrid, { byDay, dayKey, monthTitle, sameMonth } from './MonthGrid'
import { useNarrow } from './useNarrow'

// The Games tab's Calendar view: popular upcoming PC games for the next 6 months (Steam's top
// 100 / 300 / 500 / 1000 most wishlisted, chosen with buttons).
// PC: a month grid (Monday first) or a list, with a switch (GamesView.tsx). Phone: always the list.
// Grid: games with only a month ("Nov 2026") are listed under that month's grid. Games with only
// a quarter or a year ("Q1 2027", "2026") come last, in "No exact date yet" (in the list, all
// vague dates do). Click a game for a small popup (GamePreview.tsx), or its game window when it's
// already in your list (like search results). "Add" (rows) and the popup's button add a game to
// Waiting; games already in your list show where they are instead (grid: a blue tint).

export type CalendarLayout = 'grid' | 'list'
// The grid / list switch (Games → Calendar, Reminders)
export const CALENDAR_LAYOUTS: { value: CalendarLayout; label: React.ReactNode; title: string }[] = [
  { value: 'grid', label: <CalendarDays size={15} />, title: 'Month grid' },
  { value: 'list', label: <List size={15} />, title: 'List' },
]

// How many of Steam's most wishlisted upcoming games to show (buttons in GamesView.tsx)
export const TOP_LEVELS = [100, 300, 500, 1000]
export const DEFAULT_TOP = 500

// Loaded once per app start (switching views doesn't ask IGDB again)
let cache: Promise<UpcomingGame[]> | null = null

function GameCalendar(props: {
  inList: Map<string, GameStatus>
  layout: CalendarLayout
  top: number
  onOpen: (id: string) => void // a game in your list: its game window
  onMenu: (id: string, x: number, y: number) => void // a game in your list: its right-click menu
}) {
  const { inList, layout, top, onOpen, onMenu } = props
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
  if (!loaded) return <CalendarLoading grid={layout === 'grid' && !narrow} />
  const games = loaded.filter((g) => g.rank <= top) // the chosen level (top 100 / 300 / 500 / 1000)
  if (games.length === 0) return <p className="game-search-message">No upcoming games found</p>

  const statusOf = (game: UpcomingGame) => inList.get(gameId(game.igdbId))
  const show = (game: UpcomingGame) => (statusOf(game) ? onOpen(gameId(game.igdbId)) : setShown(game))
  // Right-click: the game menu, like in My games (only for games in your list)
  const menu: MenuGame = (game, event) => {
    if (!statusOf(game)) return
    event.preventDefault()
    onMenu(gameId(game.igdbId), event.clientX, event.clientY)
  }
  const grid = layout === 'grid' && !narrow
  const vague = games.filter((g) => !g.exact && !(grid && g.monthOnly))
  return (
    <div className="game-calendar">
      {grid ? (
        <CalendarGrid games={games} statusOf={statusOf} onShow={show} onMenu={menu} />
      ) : (
        <CalendarList games={games.filter((g) => g.exact)} statusOf={statusOf} onShow={show} onMenu={menu} />
      )}
      {vague.length > 0 && (
        <CalendarGroup title="No exact date yet" games={vague} statusOf={statusOf} onShow={show} onMenu={menu} />
      )}
      {shown && (
        <GamePreview game={shown} release={releaseLine(shown)} status={statusOf(shown)} onClose={() => setShown(null)} />
      )}
    </div>
  )
}

// The months shown: from this one to the end of the range. The range ends 6 months from today,
// so it usually ends partway through a 7th month.
function calendarMonths() {
  const today = new Date()
  const end = new Date(today.getFullYear(), today.getMonth() + CALENDAR_MONTHS, today.getDate())
  return Array.from({ length: CALENDAR_MONTHS + 1 }, (_, i) => new Date(today.getFullYear(), today.getMonth() + i, 1))
    .filter((first) => first < end)
}

// While Steam's list loads: the real months with soft placeholder games on some days from today
// (grid), or placeholder rows (list), so the page has its shape at once
function CalendarLoading({ grid }: { grid: boolean }) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return (
    <div className="game-calendar" aria-label="Loading upcoming games">
      {grid ? (
        <MonthGrid
          months={calendarMonths()}
          count={() => null}
          renderDay={(date) =>
            date >= today && (date.getDate() * 7) % 5 === 0 && (
              <span className="calendar-game">
                <span className="game-cover skeleton" />
                <span className="skeleton" style={{ width: '80%' }} />
              </span>
            )
          }
        />
      ) : (
        [55, 40, 62, 48, 70, 44, 58, 50].map((width, i) => (
          <div key={i} className="game-row calendar-row">
            <span className="game-cover skeleton" />
            <div className="game-text">
              <span className="skeleton" style={{ width: `${width}%` }} />
              <span className="skeleton" style={{ width: '9em', height: '0.75em' }} />
            </div>
          </div>
        ))
      )}
    </div>
  )
}

type ShowGame = (game: UpcomingGame) => void
type MenuGame = (game: UpcomingGame, event: React.MouseEvent) => void
type StatusOf = (game: UpcomingGame) => GameStatus | undefined

// Add: the game goes to Waiting. Only the list's own fields are saved (not rank etc.). Its release
// date follows the usual rule (PC first); a vague date keeps its label ("Q1 2027") and sorts last.
function pin(game: UpcomingGame) {
  const { igdbId, name, coverId, platforms, releaseDate, releaseLabel } = game
  addGame({ igdbId, name, coverId, platforms, releaseDate, releaseLabel }, 'waiting')
}

// List: one group per month
function CalendarList({ games, statusOf, onShow, onMenu }: { games: UpcomingGame[]; statusOf: StatusOf; onShow: ShowGame; onMenu: MenuGame }) {
  const months = new Map<string, UpcomingGame[]>()
  for (const game of games) {
    const month = monthTitle(new Date(game.pcDate))
    months.set(month, [...(months.get(month) ?? []), game])
  }
  return (
    <>
      {[...months].map(([title, group]) => (
        <CalendarGroup key={title} title={title} games={group} statusOf={statusOf} onShow={onShow} onMenu={onMenu} />
      ))}
    </>
  )
}

function CalendarGroup(props: { title: string; games: UpcomingGame[]; statusOf: StatusOf; onShow: ShowGame; onMenu: MenuGame }) {
  return (
    <section className="games-group">
      <h3 className="games-group-title">
        {props.title} <span className="games-count">{props.games.length}</span>
      </h3>
      <CalendarRows games={props.games} statusOf={props.statusOf} onShow={props.onShow} onMenu={props.onMenu} />
    </section>
  )
}

function CalendarRows({ games, statusOf, onShow, onMenu }: { games: UpcomingGame[]; statusOf: StatusOf; onShow: ShowGame; onMenu: MenuGame }) {
  return games.map((game) => (
    <div key={game.igdbId} className="game-row calendar-row" onClick={() => onShow(game)} onContextMenu={(e) => onMenu(game, e)}>
      <Cover coverId={game.coverId} />
      <div className="game-text">
        <div className="game-name" title={game.name}>{game.name}</div>
        <div className="game-details">{releaseLine(game)}</div>
      </div>
      <AddOrInList status={statusOf(game)} onAdd={() => pin(game)} />
    </div>
  ))
}

// The release line like everywhere else (games.ts), from the calendar's PC date: "29 Oct 2026 · in 7 days",
// or IGDB's text for a vague date ("Q1 2027")
const releaseLine = (game: UpcomingGame) =>
  releaseText({ releaseDate: game.exact ? game.pcDate : undefined, releaseLabel: game.vagueLabel }, 'full')

// Grid: every month from this one to the end of the range, stacked (MonthGrid.tsx). A day shows
// its games' covers and names; a month's month-only games are listed under its grid.
function CalendarGrid({ games, statusOf, onShow, onMenu }: { games: UpcomingGame[]; statusOf: StatusOf; onShow: ShowGame; onMenu: MenuGame }) {
  const days = byDay(
    games.filter((g) => g.exact),
    (g) => g.pcDate,
  )
  const months = calendarMonths()
  const monthOnly = (first: Date) => games.filter((g) => g.monthOnly && sameMonth(new Date(g.pcDate), first))

  return (
    <MonthGrid
      months={months}
      count={(first) => games.filter((g) => (g.exact || g.monthOnly) && sameMonth(new Date(g.pcDate), first)).length}
      renderDay={(date) =>
        (days.get(dayKey(date)) ?? []).map((game) => {
          // A game in your list: its list's icon (the tab's) before the name, "In Upcoming" on hover
          const status = statusOf(game)
          const ListIcon = status && tabOf(status).icon
          return (
            <button
              key={game.igdbId}
              className="calendar-game"
              onClick={() => onShow(game)}
              onContextMenu={(e) => onMenu(game, e)}
              title={status ? `${game.name}\nIn ${statusLabel(status)}` : game.name}
            >
              <Cover coverId={game.coverId} />
              <span>
                {ListIcon && <ListIcon size={12} className="calendar-list-icon" />}
                {game.name}
              </span>
            </button>
          )
        })
      }
      after={(first) =>
        monthOnly(first).length > 0 && (
          <div className="calendar-month-only">
            <p>{t('Sometime in {month}', { month: first.toLocaleDateString(locale(), { month: 'long' }) })}</p>
            <CalendarRows games={monthOnly(first)} statusOf={statusOf} onShow={onShow} onMenu={onMenu} />
          </div>
        )
      }
    />
  )
}

export default GameCalendar
