import { useLiveQuery } from 'dexie-react-hooks'
import { changed, db, updateGame, type Game, type SteamStats } from './db'
import { igdbProxyFetch, isComplete, loadConnection } from './igdb'
import { steamRefs } from './prices'
import { read, write } from './localState'

// Your Steam account (Settings → Games), through our proxy's /steam/… routes
// (proxy/igdb-worker.js, which holds the Steam key; owner only). Used for hours played and
// achievements ("100%") and the import of your Steam games.

export interface SteamProfile {
  link: string // as typed: a profile link, the long number or the custom name
  steamId?: string // found by the last check that worked (empty until then)
  name?: string // the profile's name, for "Connected as …"
}

const SETTING = 'steam-profile' // lower case: Dropbox lists file names in lower case

export async function loadSteamProfile(): Promise<SteamProfile> {
  const row = await db.settings.get(SETTING)
  return (row?.value as SteamProfile | undefined) ?? { link: '' }
}

// Keeps what sync knows about the last synced version (syncedRev, …)
export async function saveSteamProfile(profile: SteamProfile) {
  const change = { value: profile, updatedAt: Date.now() }
  if (!(await db.settings.update(SETTING, change))) await db.settings.put({ name: SETTING, ...change })
  changed()
}

// For the UI: the profile, updated when it changes (also from sync). undefined while loading.
export function useSteamProfile() {
  return useLiveQuery(loadSteamProfile, [])
}

async function steamApi<T>(path: string, body: object, timeoutMs = 20_000): Promise<T> {
  const response = await igdbProxyFetch(`steam/${path}`, JSON.stringify(body), timeoutMs)
  const answer = await response.json().catch(() => ({}))
  if (!response.ok || answer.error) throw new Error(answer.error ?? `Steam failed (${response.status})`)
  return answer
}

// Settings' check: the account behind what was typed. games = how many it owns, null when its
// game details are private (then nothing else works).
export const checkSteamProfile = (link: string) =>
  steamApi<{ steamId: string; name: string | null; games: number | null }>('profile', { profile: link })

// ---------- Hours played and achievements ----------

const REFRESH_EVERY = 24 * 60 * 60 * 1000
const REFRESHED_KEY = 'syncr.steamRefreshedAt' // per device
const OWNED_MS = 10 * 60_000 // the owned list is kept a few minutes (game windows opened in a row)
const ACHIEVEMENTS_PER_ASK = 40 // the proxy's limit

let owned: { steamId: string; minutes: Map<number, number>; time: number } | null = null

async function ownedMinutes(steamId: string) {
  if (owned?.steamId === steamId && Date.now() - owned.time < OWNED_MS) return owned.minutes
  const answer = await steamApi<{ games?: { appId: number; minutes: number }[]; private?: boolean }>('owned', { steamId })
  if (!answer.games) return null // game details are private
  owned = { steamId, minutes: new Map(answer.games.map((g) => [g.appId, g.minutes])), time: Date.now() }
  return owned.minutes
}

export const isHundred = (stats?: SteamStats) => !!stats?.total && stats.done === stats.total

// Hours played and achievements of these games (all Playing and Library games when none are
// given) that you own on Steam, saved on each game when they changed. Reaching 100% switches
// Completed on (once: unticked later, it stays off). Quietly does nothing when it can't.
export async function updateSteamStats(only?: Game[]) {
  try {
    const profile = await loadSteamProfile()
    if (!profile.steamId || !isComplete(await loadConnection())) return
    const games = only ?? (await db.games.filter((g) => !g.deleted && (g.status === 'playing' || g.status === 'library')).toArray())
    if (games.length === 0) return
    const minutes = await ownedMinutes(profile.steamId)
    if (!minutes) return
    const refs = await steamRefs(games.map((g) => g.igdbId))
    const mine = games
      .map((game) => ({ game, appId: refs.get(game.igdbId)?.kind === 'app' ? refs.get(game.igdbId)!.id : undefined }))
      .filter((g): g is { game: Game; appId: number } => g.appId !== undefined && minutes.has(g.appId))
    for (let i = 0; i < mine.length; i += ACHIEVEMENTS_PER_ASK) {
      const batch = mine.slice(i, i + ACHIEVEMENTS_PER_ASK)
      const achievements = await steamApi<Record<string, { done: number; total: number } | null>>('achievements', {
        steamId: profile.steamId,
        appIds: batch.map((g) => g.appId),
      })
      for (const { game, appId } of batch) {
        // No answer for a game that had achievements (Steam hiccup): keep the last count
        const before = game.steamStats
        const got = achievements[appId] ?? (before?.total ? { done: before.done!, total: before.total } : null)
        const stats: SteamStats = { minutes: minutes.get(appId)!, ...(got && { done: got.done, total: got.total }) }
        if (before && before.minutes === stats.minutes && before.done === stats.done && before.total === stats.total) continue
        const reached = isHundred(stats) && !isHundred(before)
        await updateGame(game.id, { steamStats: stats, ...(reached && { completed: true }) })
      }
    }
  } catch (e) {
    console.warn('Steam stats failed', e)
  }
}

// Once a day per device (games.ts: after a sync, like the game refresh)
export async function refreshSteamStats() {
  if (Date.now() - read<number>(REFRESHED_KEY, 0) < REFRESH_EVERY) return
  write(REFRESHED_KEY, Date.now())
  await updateSteamStats()
}

// "42 h played", "4.5 h played", "35 min played"
export function playedText(minutes: number) {
  if (minutes < 60) return `${minutes} min played`
  const hours = minutes / 60
  return `${hours < 10 ? hours.toFixed(1).replace(/\.0$/, '') : Math.round(hours)} h played`
}
