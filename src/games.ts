import { changed, db, type Game, type GameStatus } from './db'
import type { FoundGame } from './igdb'

// The Games tab (GamesView.tsx): adding games and how the status groups are ordered.

export const GAMES_TAB = 'games' // its id among the open tabs (note ids never look like this)

export const STATUSES: { status: GameStatus; label: string }[] = [
  { status: 'waiting', label: 'Waiting' },
  { status: 'toplay', label: 'To play' },
  { status: 'playing', label: 'Playing' },
  { status: 'done', label: 'Done' },
  { status: 'dropped', label: 'Dropped' },
]

export const gameId = (igdbId: number) => `igdb-${igdbId}`

export const isReleased = (game: { releaseDate?: number }) => !!game.releaseDate && game.releaseDate <= Date.now()

// Added from the search: Waiting if it isn't out yet, otherwise To play.
// A game removed earlier comes back with its note, review and rating.
export async function addGame(found: FoundGame) {
  const id = gameId(found.igdbId)
  const before = await db.games.get(id)
  if (before && !before.deleted) return
  const now = Date.now()
  await db.games.put({
    note: '',
    review: '',
    liked: false,
    priority: false,
    createdAt: now,
    ...before,
    ...found,
    id,
    status: isReleased(found) ? 'toplay' : 'waiting',
    statusAt: now,
    deleted: false,
    updatedAt: now,
  })
  changed()
}

// Flagged games first. Waiting: soonest release first, not announced (TBA) last.
// The others: most recent first (Done: newest finish date first).
export function sortGames(games: Game[]): Game[] {
  return [...games].sort(
    (a, b) =>
      Number(b.priority) - Number(a.priority) ||
      (a.status === 'waiting'
        ? (a.releaseDate ?? Infinity) - (b.releaseDate ?? Infinity) || a.name.localeCompare(b.name)
        : b.statusAt - a.statusAt),
  )
}

// "12 Mar 2027", or "TBA" when there's no date yet
export function formatRelease(time?: number) {
  if (!time) return 'TBA'
  return new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
