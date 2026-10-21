import { changed, db, updateGame, setGameStatus, type Game, type GameStatus } from './db'
import { fetchGames, isComplete, loadConnection, moveOldConnection, type FoundGame } from './igdb'
import { isConnected as dropboxConnected } from './dropbox'
import { getStatus, subscribe } from './autoSync'
import { loadToPlayPrices } from './prices'
import { read, write } from './localState'
import { refreshEvents, removeReleaseEvent, saveReleaseEvent } from './calendarEvents'
import { isConnected as googleConnected } from './google'

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
    ...(before && { restoredAt: now }), // added again after removing: beats the removal in sync
    updatedAt: now,
  })
  changed()
}

// Priority games first. Waiting: soonest release first, not announced (TBA) last.
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

const startOfDay = (time: number) => new Date(time).setHours(0, 0, 0, 0)

// Once a day: fresh names, covers, platforms and release dates from IGDB. Only changed games
// are saved (so they sync). A later date for a Waiting game is a delay: delayedFrom keeps the
// first date it had, for the banner in the Games tab.
export async function refreshGames(force = false) {
  if (!isComplete(await loadConnection())) return
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
      // A later day (not just a later time on the same day) counts as a delay
      const later = !found.releaseDate || startOfDay(found.releaseDate) > startOfDay(game.releaseDate!)
      if (game.status === 'waiting' && game.releaseDate && later) change.delayedFrom = game.delayedFrom ?? game.releaseDate
      // Moved back to (or before) its first date: no longer delayed
      if (game.delayedFrom && found.releaseDate && startOfDay(found.releaseDate) <= startOfDay(game.delayedFrom)) {
        change.delayedFrom = undefined
      }
    }
    if (Object.keys(change).length > 0) await updateGame(game.id, change)
  }
  write(REFRESHED_KEY, Date.now())
}

// ---------- Release events (Google Calendar, see calendarEvents.ts) ----------

const REMIND_DAYS_BEFORE = 2
const REMIND_HOUR = 10
// An all-day event's alert counts back from its day's midnight: 2 days before, at 10:00
const RELEASE_ALERT = REMIND_DAYS_BEFORE * 24 * 60 - REMIND_HOUR * 60

// The game's event id: fixed, so the PC and the phone always mean the same event
export const releaseEventId = (game: Pick<Game, 'igdbId'>) => `game${game.igdbId}`

// What this device last made sure of in Google, per event id ("<day>|<name>", or "removed"),
// so the check after every sync doesn't ask Google again and again. Until the app closes.
const confirmed = new Map<string, string>()

// One Google Calendar event (all-day, Grape, titled with the game's name) per Waiting game with
// an exact date that isn't out yet. A new date moves it; a game that no longer qualifies (removed,
// another status) loses it, if its day hasn't come yet. One the user deleted in Google stays
// deleted until the date changes (calendarEvents.ts saveReleaseEvent). Needs Google Calendar
// connected on this device. Google is only asked when the stored events (the next 12 months)
// don't already match.
export async function syncReleaseEvents() {
  if (!googleConnected()) return
  const stored = new Map((await db.events.toArray()).map((event) => [event.id, event]))
  let googleChanged = false
  for (const game of await db.games.toArray()) {
    const id = releaseEventId(game)
    const wanted = !game.deleted && game.status === 'waiting' && !!game.releaseDate && !isReleased(game)
    if (!wanted) {
      // Only events that may exist: stored, or made earlier while the app was open
      if ((!stored.has(id) && !confirmed.has(id)) || confirmed.get(id) === 'removed') continue
      if (await removeReleaseEvent(id)) googleChanged = true
      confirmed.set(id, 'removed')
      continue
    }
    const day = startOfDay(game.releaseDate!)
    const mark = `${day}|${game.name}`
    const event = stored.get(id)
    const matches = event?.allDay && event.start === day && event.title === game.name
    if (confirmed.get(id) !== mark && !matches) {
      if (await saveReleaseEvent({ id, title: game.name, day, alert: RELEASE_ALERT })) googleChanged = true
    }
    confirmed.set(id, mark)
  }
  if (googleChanged) await refreshEvents()
}

// Started once by the app. The refresh and the release events wait for a finished sync (when
// Dropbox is set up): saving makes a record the newest copy, which must not win over an edit
// made on the other device that hasn't arrived yet; and the release events must follow the
// latest game list (e.g. a game removed on the phone).
let started = false
export function startGameChecks() {
  if (started) return
  moveOldConnection().catch((e) => console.warn('Could not move the game search settings', e))
  started = true
  let pricesLoaded = false
  const check = async () => {
    try {
      await moveReleased()
      if (!dropboxConnected()) await syncReleaseEvents() // with Dropbox: after each sync (refresh)
    } catch (e) {
      console.warn('Release day check failed', e)
    }
  }
  const refresh = async () => {
    try {
      await refreshGames()
      await moveReleased() // a date may have moved to today
      await syncReleaseEvents()
    } catch (e) {
      console.warn('Game refresh failed', e)
    }
    // To play prices, once per start, after the first sync brought the list up to date
    if (!pricesLoaded) {
      pricesLoaded = true
      loadToPlayPrices()
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
