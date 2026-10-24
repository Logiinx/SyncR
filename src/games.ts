import { changed, db, isWatched, matchGamePriorities, pinnedCard, updateGame, setGameStatus, type Game, type GameStatus } from './db'
import type { DialogRequest } from './Dialog'
import { fetchGames, isComplete, loadConnection, moveOldConnection, type FoundGame } from './igdb'
import { isConnected as dropboxConnected } from './dropbox'
import { getStatus, subscribe } from './autoSync'
import { loadListPrices } from './prices'
import { loadListEditions } from './editions'
import { checkWatches, CHECK_EVERY as WATCH_EVERY } from './priceWatch'
import { refreshSteamStats } from './steam'
import { shortDate } from './dates'
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
  { status: 'library', label: 'Library' },
]
export const statusLabel = (status?: GameStatus) => STATUSES.find((s) => s.status === status)?.label

// Where a released game can be added (search's "Add ▾", the preview's "Add to list ▾"), in the
// tabs' order. "Completed" = Library with Completed on. No Waiting: it's out already.
export interface AddPlace { label: string; status: GameStatus; completed?: boolean }
export const ADD_PLACES: AddPlace[] = [
  { label: 'To play', status: 'toplay' },
  { label: 'Playing', status: 'playing' },
  { label: 'Library', status: 'library' },
  { label: 'Completed', status: 'library', completed: true },
]

// Rating, heart, review and "Completed": only for games being played or in the Library (the
// rating stays saved if the status changes back)
export const isPlayed = (game: Game) => game.status === 'playing' || game.status === 'library'

// The priority switch is called Favorite (a heart) in the Library, Priority (sparkles) elsewhere.
// Same stored value; moving into or out of the Library switches it off (setGameStatus).
export const isFavoriteTab = (game: { status: GameStatus }) => game.status === 'library'
export const priorityLabel = (game: { status: GameStatus; priority: boolean }) =>
  isFavoriteTab(game)
    ? (game.priority ? 'Remove favorite' : 'Mark as favorite')
    : (game.priority ? 'Remove priority' : 'Mark as priority')

export const gameId = (igdbId: number) => `igdb-${igdbId}`

// Out from the start of its release day (local time). Only an exact date counts.
export const isReleased = (game: { releaseDate?: number }) =>
  !!game.releaseDate && new Date(game.releaseDate).setHours(0, 0, 0, 0) <= Date.now()

// Added from the search: Waiting if it isn't out yet, otherwise To play. The calendar's pin
// always gives Waiting. A game removed earlier comes back with its note, review and rating.
export async function addGame(found: FoundGame, status?: GameStatus, completed?: boolean) {
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
    ...(completed && { completed: true }),
    statusAt: now,
    deleted: false,
    ...(before && { restoredAt: now }), // added again after removing: beats the removal in sync
    updatedAt: now,
  })
  changed()
}

// "Remove game?" (Games, Board, Reminders): the game leaves your list with its note and review;
// its Board card, if any, stays (dimmed). onRemoved closes whatever showed the game.
export async function removeGameQuestion(game: Game, onRemoved: () => void): Promise<DialogRequest> {
  const pinned = await pinnedCard(game.id)
  return {
    title: 'Remove game?',
    message: `"${game.name}" will be removed from your list, with its note and review.${pinned ? ' Its card stays on the Board.' : ''}`,
    confirmLabel: 'Remove',
    danger: true,
    onConfirm: () => {
      onRemoved()
      updateGame(game.id, { deleted: true })
    },
  }
}

// Priority games first. Waiting: soonest release first, not announced (TBA) last.
// The others: most recent first (Library: newest added first).
export function sortGames(games: Game[]): Game[] {
  return [...games].sort(
    (a, b) =>
      Number(b.priority) - Number(a.priority) ||
      Number(isWatched(b)) - Number(isWatched(a)) || // price watched (To play, Waiting)
      (a.status === 'waiting'
        ? (a.releaseDate ?? Infinity) - (b.releaseDate ?? Infinity) || a.name.localeCompare(b.name)
        : b.statusAt - a.statusAt),
  )
}

// A game's platforms, PC and Android first (what you play on). Windows (game window, preview,
// trailer view) show them all; rows (search results) at most 3, then "+N more":
// "PC, PS5, XONE +4 more".
const MY_PLATFORMS = ['PC', 'Android']
const SHOWN_PLATFORMS = 3
const sortPlatforms = (platforms: string[]) => [
  ...MY_PLATFORMS.filter((p) => platforms.includes(p)),
  ...platforms.filter((p) => !MY_PLATFORMS.includes(p)),
]
export const allPlatforms = (platforms: string[]) => sortPlatforms(platforms).join(', ')
export function shortPlatforms(platforms: string[]) {
  const sorted = sortPlatforms(platforms)
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
  return shortDate(time)
}

// A game's release line, the one place that decides it (each view had its own copy, and they
// drifted apart). No exact day: the vague date ("Mar 2027") or "TBA", in every form.
// 'full' (search results, preview, game window, Games calendar): the date, plus the countdown until it's out.
// 'year' (Games list): while waiting the date + countdown, else the year.
// 'short' (Games grid): while waiting the countdown alone (the tooltip has the date), else the year.
export function releaseText(game: { releaseDate?: number; releaseLabel?: string; status?: string }, form: 'full' | 'year' | 'short') {
  const date = formatRelease(game.releaseDate, game.releaseLabel)
  if (!game.releaseDate) return date
  // ('full' still counts down on the release day itself: "22 Oct 2026 · today")
  const upcoming = form === 'full' ? releaseCountdown(game.releaseDate) !== 'out now' : game.status === 'waiting'
  if (!upcoming) return form === 'full' ? date : String(new Date(game.releaseDate).getFullYear())
  const countdown = releaseCountdown(game.releaseDate)
  return form === 'short' ? countdown : `${date} · ${countdown}`
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

// How precise a release date is (TBA 0, year 1, quarter 2, month 3, exact day 4) and the period
// it covers. Vague dates are IGDB's texts: "2026", "Q1 2027", "Nov 2026". TBA, or a text SyncR
// doesn't know, covers all time.
function releasePeriod(time?: number, label?: string): { level: number; start: number; end: number } {
  if (time) {
    const day = startOfDay(time)
    return { level: 4, start: day, end: new Date(day).setDate(new Date(day).getDate() + 1) }
  }
  let match = label?.match(/^(\d{4})$/)
  if (match) return { level: 1, start: new Date(+match[1], 0, 1).getTime(), end: new Date(+match[1] + 1, 0, 1).getTime() }
  match = label?.match(/^Q([1-4]) (\d{4})$/)
  if (match) {
    const [quarter, year] = [+match[1], +match[2]]
    return { level: 2, start: new Date(year, quarter * 3 - 3, 1).getTime(), end: new Date(year, quarter * 3, 1).getTime() }
  }
  const month = label && /^[A-Z][a-z]{2} \d{4}$/.test(label) ? new Date(`1 ${label}`) : undefined
  if (month && !isNaN(month.getTime())) {
    return { level: 3, start: month.getTime(), end: new Date(month.getFullYear(), month.getMonth() + 1, 1).getTime() }
  }
  return { level: 0, start: Infinity, end: Infinity }
}

// Once a day: fresh names, covers, platforms and release dates from IGDB. Only changed games
// are saved (so they sync). For the banners in the Games tab, a Waiting game's new date is:
// - a delay when it starts after the old date's period ends (Q1 2027 → 15 Jun 2027):
//   delayedFrom / delayedFromLabel keep the first date it had;
// - else "Date set" when it's more precise (TBA → 2027 → Q1 2027 → Feb 2027 → 15 Feb 2027):
//   datedFrom keeps the first vaguer date. A delay wins over it (user's choice).
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
      const before = releasePeriod(game.releaseDate, game.releaseLabel)
      const after = releasePeriod(found.releaseDate, found.releaseLabel)
      if (game.status === 'waiting' && after.start >= before.end) {
        // Delayed (a later day, not just a later time on the same day)
        if (game.delayedFrom === undefined && game.delayedFromLabel === undefined) {
          if (game.releaseDate) change.delayedFrom = game.releaseDate
          else change.delayedFromLabel = game.releaseLabel
        }
        change.datedFrom = undefined
      } else if (game.status === 'waiting' && after.level > before.level) {
        change.datedFrom = game.datedFrom ?? formatRelease(game.releaseDate, game.releaseLabel)
      }
      // Moved back into (or before) its first date: no longer delayed
      const first = game.delayedFrom || game.delayedFromLabel ? releasePeriod(game.delayedFrom, game.delayedFromLabel) : undefined
      if (first && after.start < first.end) {
        change.delayedFrom = undefined
        change.delayedFromLabel = undefined
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

// v0.20: "Done" became Library with Completed on, "Dropped" went (its games go to the Library,
// not completed). After each sync, so it also catches games an older app version still marks.
async function upgradeOldStatuses() {
  const old = await db.games.filter((g) => !g.deleted && ['done', 'dropped', 'watched'].includes(g.status as string)).toArray()
  for (const game of old) {
    if ((game.status as string) === 'watched') await updateGame(game.id, { status: isReleased(game) ? 'toplay' : 'waiting' })
    else await updateGame(game.id, { status: 'library', completed: (game.status as string) === 'done' || game.completed })
  }
  // v0.23: the heart became Favorite (the Library's priority). Elsewhere it's just dropped.
  const hearts = await db.games.filter((g) => !g.deleted && g.liked).toArray()
  for (const game of hearts) await updateGame(game.id, { liked: false, ...(isFavoriteTab(game) && { priority: true }) })
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
      await upgradeOldStatuses()
      await matchGamePriorities()
      await refreshGames()
      await refreshSteamStats()
      await moveReleased() // a date may have moved to today
      await syncReleaseEvents()
    } catch (e) {
      console.warn('Game refresh failed', e)
    }
    // To play (and watched Waiting) prices, once per start, after the first sync brought the list up to date
    // and the price alerts then and every 6 hours; a minute later the editions (game windows)
    if (!pricesLoaded) {
      pricesLoaded = true
      loadListPrices().then(checkWatches)
      window.setTimeout(loadListEditions, 60_000)
      window.setInterval(checkWatches, WATCH_EVERY)
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
