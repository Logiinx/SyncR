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

// Platforms for a search result: PC and Android first (what you play on), at most 3, then "+N more".
// E.g. "PC, PS5, XONE +4 more". The details dialog still shows them all.
const MY_PLATFORMS = ['PC', 'Android']
const SHOWN_PLATFORMS = 3
export function shortPlatforms(platforms: string[]) {
  const sorted = [
    ...MY_PLATFORMS.filter((p) => platforms.includes(p)),
    ...platforms.filter((p) => !MY_PLATFORMS.includes(p)),
  ]
  const shown = sorted.slice(0, SHOWN_PLATFORMS).join(', ')
  const more = sorted.length - SHOWN_PLATFORMS
  return more > 0 ? `${shown} +${more} more` : shown
}

// How long until a release: "today", "tomorrow", "in 34 days", "in 5 months", or "out now" once
// it's past (a game stays in Waiting until it's moved). Counts calendar days, not 24h blocks.
const DAY = 24 * 60 * 60 * 1000
export function releaseCountdown(time?: number) {
  if (!time) return ''
  const midnight = (t: number) => new Date(t).setHours(0, 0, 0, 0)
  const days = Math.round((midnight(time) - midnight(Date.now())) / DAY)
  if (days < 0) return 'out now'
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days < 60) return `in ${days} days`
  return `in ${Math.round(days / 30.4)} months`
}

// "12 Mar 2027", or "TBA" when there's no date yet
export function formatRelease(time?: number) {
  if (!time) return 'TBA'
  return new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
