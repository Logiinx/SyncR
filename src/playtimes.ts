import { useLiveQuery } from 'dexie-react-hooks'
import { db, updateGame, type Game, type Playtime } from './db'
import { igdbProxyFetch, isComplete, loadConnection } from './igdb'

// HowLongToBeat's play times, through the Worker's /playtime (it searches once per game, then
// reads the game's page). Kept on each device (db.playtimes): each device asks for itself. Only a
// page the user picked syncs, on the game (Game.hltbId, a pasted link).

const DAY = 86_400_000
const PAUSE_MS = 1500 // between two games: their site refuses those who ask too fast
const AGAIN_AFTER = 30 * DAY
const AGAIN_SOON = 7 * DAY // not found yet, not out yet, or out lately: its times still change
const LATELY = 180 * DAY
const FAILS_TO_STOP = 3 // in a row: offline, an older Worker, or their site refusing for now
const RETRY_MS = 10 * 60_000

function due(game: Game, row: Playtime | undefined, now: number) {
  if (!row) return true
  if (game.hltbId && row.hltbId !== game.hltbId) return true // a link was pasted (maybe on the other device)
  const moving = row.hltbId === null || !game.releaseDate || game.releaseDate > now - LATELY
  return now - row.checkedAt > (moving ? AGAIN_SOON : AGAIN_AFTER)
}

// One game. false = no answer now (their site sometimes refuses one): nothing is saved, it's asked
// again next run.
async function askOne(game: Game, row: Playtime | undefined) {
  // The page known already: read it again; no page yet: search
  const hltbId = game.hltbId ?? row?.hltbId
  try {
    const response = await igdbProxyFetch('playtime', JSON.stringify(hltbId ? { hltbId } : { igdbId: game.igdbId }), 30_000)
    const answer = await response.json().catch(() => ({}))
    if (!response.ok) {
      console.warn(`HowLongToBeat: no answer for ${game.name} (${response.status})`, answer.error ?? '')
      return false
    }
    // A page that's gone: searched again next time
    const found = typeof answer.id === 'number'
    await db.playtimes.put({ id: game.id, hltbId: found ? answer.id : null, main: answer.main || 0, plus: answer.plus || 0, full: answer.full || 0, checkedAt: Date.now() })
    return true
  } catch (e) {
    console.warn(`HowLongToBeat: no answer for ${game.name}`, e)
    return false
  }
}

let running = false
let again = false
let retryTimer = 0

// Every game whose times are missing or old, newest added first, one at a time. Called after each
// game refresh and when a game is added or a link pasted: while it runs, that starts it over, so
// the new one comes next.
export async function refreshPlaytimes() {
  if (running) {
    again = true
    return
  }
  running = true
  window.clearTimeout(retryTimer)
  try {
    do {
      again = false
      if (!isComplete(await loadConnection())) return
      const [games, rows] = await Promise.all([db.games.filter((game) => !game.deleted).toArray(), db.playtimes.toArray()])
      const kept = new Set(games.map((game) => game.id))
      await db.playtimes.bulkDelete(rows.filter((row) => !kept.has(row.id)).map((row) => row.id))
      const known = new Map(rows.map((row) => [row.id, row]))
      const now = Date.now()
      const waiting = games.filter((game) => due(game, known.get(game.id), now)).sort((a, b) => b.createdAt - a.createdAt)
      let fails = 0
      for (const game of waiting) {
        fails = (await askOne(game, known.get(game.id))) ? 0 : fails + 1
        if (fails >= FAILS_TO_STOP) {
          retryTimer = window.setTimeout(() => void refreshPlaytimes(), RETRY_MS)
          return
        }
        await new Promise((resolve) => window.setTimeout(resolve, PAUSE_MS))
        if (again) break
      }
    } while (again)
  } finally {
    running = false
  }
}

// A HowLongToBeat link pasted in the game window: that page from now on, on every device. Answers
// false when it isn't a game's link.
export async function pickPlaytimePage(game: Game, link: string) {
  const id = Number(link.trim().match(/howlongtobeat\.com\/game\/(\d+)/i)?.[1] ?? NaN)
  if (!Number.isInteger(id) || id <= 0) return false
  await updateGame(game.id, { hltbId: id })
  void refreshPlaytimes()
  return true
}

export const playtimeLink = (hltbId: number) => `https://howlongtobeat.com/game/${hltbId}`

// The times of every game, by its id. undefined while loading.
export function usePlaytimes() {
  return useLiveQuery(async () => new Map((await db.playtimes.toArray()).map((row) => [row.id, row])), [])
}
