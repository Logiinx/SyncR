import { changed, db, updateGame, setGameStatus, type Game, type GameStatus } from './db'
import { fetchGames, isComplete, loadConnection, moveOldConnection, type FoundGame } from './igdb'
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
    ...(before && { restoredAt: now }), // added again after removing: beats the removal in sync
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
      const later = !found.releaseDate || found.releaseDate > game.releaseDate!
      if (game.status === 'waiting' && game.releaseDate && later) change.delayedFrom = game.delayedFrom ?? game.releaseDate
      // Moved back to (or before) its first date: no longer delayed
      if (game.delayedFrom && found.releaseDate && found.releaseDate <= game.delayedFrom) change.delayedFrom = undefined
    }
    if (Object.keys(change).length > 0) await updateGame(game.id, change)
  }
  write(REFRESHED_KEY, Date.now())
}

// ---------- Release reminders (shown in the Reminders tab) ----------

const REMIND_DAYS_BEFORE = 2
const REMIND_HOUR = 10

// 10:00, two days before the release day
export function releaseReminderTime(releaseDate: number) {
  const time = new Date(releaseDate)
  time.setDate(time.getDate() - REMIND_DAYS_BEFORE)
  time.setHours(REMIND_HOUR, 0, 0, 0)
  return time.getTime()
}

export const releaseReminderText = (game: Pick<Game, 'name' | 'releaseDate'>) =>
  `${game.name} comes out on ${new Date(game.releaseDate!).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`

// One reminder per Waiting game with an exact date that isn't out yet. Its id comes from the
// game's id, so two devices make the same reminder, not two. gameRelease = the date it was
// made for: a new date (delay) moves it and brings it back (even if done or deleted); the same
// date leaves it alone (so a reminder you deleted stays deleted). When the game no longer
// qualifies, an unfinished reminder is removed (gameRelease cleared, so pinning again makes a
// new one). Only saves what changed.
export async function syncReleaseReminders() {
  const now = Date.now()
  for (const game of await db.games.toArray()) {
    const id = `release-${game.id}`
    const existing = await db.reminders.get(id)
    const wanted = !game.deleted && game.status === 'waiting' && !!game.releaseDate && !isReleased(game)
    if (!wanted) {
      if (existing && !existing.deleted && existing.doneAt === null) {
        await db.reminders.update(id, { deleted: true, text: '', note: '', gameRelease: undefined, updatedAt: now })
        changed()
      }
      continue
    }
    const text = releaseReminderText(game)
    if (existing && existing.gameRelease === game.releaseDate) {
      // Same date: only follow a new name
      if (!existing.deleted && existing.text !== text) {
        await db.reminders.update(id, { text, updatedAt: now })
        changed()
      }
      continue
    }
    await db.reminders.put({
      phone: false,
      createdAt: now,
      ...existing,
      id,
      text,
      note: '',
      dueAt: Math.max(releaseReminderTime(game.releaseDate!), now), // pinned less than 2 days before: now
      gameId: game.id,
      gameRelease: game.releaseDate,
      doneAt: null,
      deleted: false,
      ...(existing?.deleted && { restoredAt: now }), // brought back by a new date: beats the deletion
      updatedAt: now,
    })
    changed()
  }
}

// Started once by the app. The refresh and the release reminders wait for a finished sync (when
// Dropbox is set up): saving makes a record the newest copy, which must not win over an edit
// made on the other device that hasn't arrived yet (e.g. a reminder marked done on the phone).
let started = false
export function startGameChecks() {
  if (started) return
  moveOldConnection().catch((e) => console.warn('Could not move the game search settings', e))
  started = true
  const check = async () => {
    try {
      await moveReleased()
      if (!dropboxConnected()) await syncReleaseReminders() // with Dropbox: after each sync (refresh)
    } catch (e) {
      console.warn('Release day check failed', e)
    }
  }
  const refresh = async () => {
    try {
      await refreshGames()
      await moveReleased() // a date may have moved to today
      await syncReleaseReminders()
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
