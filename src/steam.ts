import { useLiveQuery } from 'dexie-react-hooks'
import { changed, db } from './db'
import { igdbProxyFetch } from './igdb'

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
