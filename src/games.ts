import { changed, db, updateGame, setGameStatus, type Game, type GameStatus } from './db'
import { fetchGames, isConnected as igdbConnected, type FoundGame } from './igdb'
import { isConnected as dropboxConnected } from './dropbox'
import { getStatus, subscribe } from './autoSync'
import { read, write } from './localState'

// The Games tab (GamesView.tsx): adding games, how the status groups are ordered, and the
// background checks (release day, daily refresh from IGDB).

export const GAMES_TAB = 'games' // its id among the open tabs (note ids never look like this)

export const STATUSES: { status: GameStatus; label: string }[] = [
  { status: 'waiting', label: 'Waiting' },
  { status: 'toplay', label: 'To play' },
  { status: 'playing', label: 'Playing' },
  { status: 'done', label: 'Done' },
  { status: 'dropped', label: 'Dropped' },
]

export const gameId = (igdbId: number) => `igdb-${igdbId}`

// Out from the start of its release day (local time). Only an exact date counts.
export const isReleased = (game: { releaseDate?: number }) =>
  !!game.releaseDate && new Date(game.releaseDate).setHours(0, 0, 0, 0) <= Date.now()

// Added from the search: Waiting if it isn't out yet, otherwise To play. The calendar's pin
// always gives Waiting. A game removed earlier comes back with its note, review and rating.
export async function addGame(found: FoundGame, status?: GameStatus) {
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
    status: status ?? (isReleased(found) ? 'toplay' : 'waiting'),
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

// "12 Mar 2027", a vague date ("Q1 2027"), or "TBA" when there's no date yet
export function formatRelease(time?: number, label?: string) {
  if (!time) return label || 'TBA'
  return new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ---------- Background checks ----------

const CHECK_EVERY = 10 * 60 * 1000 // release day check, ms
const REFRESH_EVERY = 24 * 60 * 60 * 1000
const REFRESHED_KEY = 'syncr.gamesRefreshedAt' // per device

// Release day: Waiting games whose (exact) day has come move to To play
export async function moveReleased() {
  const due = await db.games.filter((g) => !g.deleted && g.status === 'waiting' && isReleased(g)).toArray()
  for (const game of due) await setGameStatus(game.id, 'toplay')
}

// Once a day: fresh names, covers, platforms and release dates from IGDB. Only changed games
// are saved (so they sync). A later date for a Waiting game is a delay: delayedFrom keeps the
// first date it had, for the banner in the Games tab.
export async function refreshGames(force = false) {
  if (!igdbConnected()) return
  if (!force && Date.now() - read<number>(REFRESHED_KEY, 0) < REFRESH_EVERY) return
  const games = await db.games.filter((g) => !g.deleted).toArray()
  const fresh = new Map((await fetchGames(games.map((g) => g.igdbId))).map((f) => [f.igdbId, f]))
  for (const game of games) {
    const found = fresh.get(game.igdbId)
    if (!found) continue
    const change: Partial<Game> = {}
    if (found.name !== game.name) change.name = found.name
    if (found.coverId && found.coverId !== game.coverId) change.coverId = found.coverId
    if (found.platforms.join() !== game.platforms.join()) change.platforms = found.platforms
    if (found.releaseDate !== game.releaseDate || found.releaseLabel !== game.releaseLabel) {
      change.releaseDate = found.releaseDate
      change.releaseLabel = found.releaseLabel
      const later = !found.releaseDate || found.releaseDate > game.releaseDate!
      if (game.status === 'waiting' && game.releaseDate && later) change.delayedFrom = game.delayedFrom ?? game.releaseDate
      // Moved back to (or before) its first date: no longer delayed
      if (game.delayedFrom && found.releaseDate && found.releaseDate <= game.delayedFrom) change.delayedFrom = undefined
    }
    if (Object.keys(change).length > 0) await updateGame(game.id, change)
  }
  write(REFRESHED_KEY, Date.now())
}

// Started once by the app. The refresh waits for a finished sync (when Dropbox is set up):
// saving a game makes it the newest copy, which must not win over an edit made on the other
// device that hasn't arrived yet.
let started = false
export function startGameChecks() {
  if (started) return
  started = true
  const check = async () => {
    try {
      await moveReleased()
    } catch (e) {
      console.warn('Release day check failed', e)
    }
  }
  const refresh = async () => {
    try {
      await refreshGames()
      await moveReleased() // a date may have moved to today
    } catch (e) {
      console.warn('Game refresh failed', e)
    }
  }
  check()
  window.setInterval(check, CHECK_EVERY)
  if (!dropboxConnected()) refresh()
  let lastSync = getStatus().lastSuccessAt
  subscribe(() => {
    const { lastSuccessAt } = getStatus()
    if (lastSuccessAt === lastSync) return
    lastSync = lastSuccessAt
    refresh()
  })
}
