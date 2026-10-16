import { useEffect, useState } from 'react'
import { gameId, releaseCountdown, STATUSES } from './games'
import { popularUpcoming, type UpcomingGame } from './igdb'
import type { GameStatus } from './db'
import Cover from './GameCover'

// The Games tab's Calendar view: popular upcoming PC games for the next 6 months, grouped by
// month. Games with only a vague date ("Q1 2027", "2026") come last, in their own group.

// Loaded once per app start (switching views doesn't ask IGDB again)
let cache: Promise<UpcomingGame[]> | null = null

function GameCalendar({ inList }: { inList: Map<string, GameStatus> }) {
  const [games, setGames] = useState<UpcomingGame[] | null>(null)
  const [error, setError] = useState('')

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

  const groups = new Map<string, UpcomingGame[]>()
  for (const game of games.filter((g) => g.exact)) {
    const month = new Date(game.pcDate).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    groups.set(month, [...(groups.get(month) ?? []), game])
  }
  const vague = games.filter((g) => !g.exact)
  if (vague.length > 0) groups.set('No exact date yet', vague)

  const label = (status?: GameStatus) => STATUSES.find((s) => s.status === status)?.label
  return (
    <div className="game-calendar">
      {[...groups].map(([title, group]) => (
        <section key={title} className="games-group">
          <h3 className="games-group-title">
            {title} <span className="games-count">{group.length}</span>
          </h3>
          {group.map((game) => {
            const status = inList.get(gameId(game.igdbId))
            const when = game.exact
              ? `${new Date(game.pcDate).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · ${releaseCountdown(game.pcDate)}`
              : game.vagueLabel
            return (
              <div key={game.igdbId} className="game-row">
                <Cover coverId={game.coverId} />
                <div className="game-text">
                  <div className="game-name">{game.name}</div>
                  <div className="game-details">{when}</div>
                </div>
                {status && <span className="game-in-list">In {label(status)}</span>}
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}

export default GameCalendar
