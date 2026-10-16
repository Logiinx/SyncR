import { read, write } from './localState'

// Game data from IGDB, through SyncR's own proxy (proxy/igdb-worker.js, a Cloudflare Worker):
// IGDB can't be called from a web page directly and needs a secret that can't be in the app.
// The proxy's address and password are set in Settings, per device (never synced).

export interface IgdbConnection {
  url: string // e.g. https://syncr-igdb.<name>.workers.dev
  password: string
}

const KEY = 'igdb'

export function loadConnection(): IgdbConnection {
  return read<IgdbConnection>(KEY, { url: '', password: '' })
}

export function saveConnection(connection: IgdbConnection) {
  write(KEY, connection)
}

export function isConnected() {
  const { url, password } = loadConnection()
  return !!url && !!password
}

// The address as typed, made absolute: without "https://" the browser would treat it as a
// path inside SyncR's own site (and get SyncR's page back instead of game data)
function proxyUrl(typed: string) {
  const url = typed.trim().replace(/\/+$/, '')
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

// One IGDB query, e.g. igdb('games', 'search "Guild Wars"; fields name; limit 5;')
export async function igdb<T>(endpoint: string, query: string, connection = loadConnection()): Promise<T[]> {
  if (!connection.url || !connection.password) throw new Error('Game search is not set up (Settings → Games)')
  let response: Response
  try {
    response = await fetch(`${proxyUrl(connection.url)}/${endpoint}`, {
      method: 'POST',
      headers: { 'X-SyncR-Password': connection.password },
      body: query,
    })
  } catch {
    throw new Error('Could not reach the game search proxy (offline, or wrong address?)')
  }
  if (response.status === 401) throw new Error('Wrong password for the game search proxy')
  if (!response.ok) throw new Error(`Game search failed (${response.status}): ${await response.text()}`)
  if (!response.headers.get('Content-Type')?.includes('application/json')) {
    throw new Error('The game search proxy address is wrong (it answered with a web page)')
  }
  return response.json()
}

// ---------- Searching games ----------

// A game as found in IGDB, before it's in the list
export interface FoundGame {
  igdbId: number
  name: string
  coverId?: string
  releaseDate?: number // ms
  platforms: string[]
}

interface IgdbGame {
  id: number
  name: string
  first_release_date?: number // seconds
  cover?: { image_id: string }
  platforms?: { name: string; abbreviation?: string }[]
}

// IGDB game types: main game 0, standalone expansion 4, remake 8, remaster 9,
// expanded game 10, port 11. Left out unless asked: DLC 1, expansion 2, bundle 3, mod 5,
// episode 6, season 7, fork 12, pack 13, update 14. Editions ("Gold Edition") have a version_parent.
const MAIN_GAME_TYPES = '(0,4,8,9,10,11)'

export async function searchGames(text: string, includeDlc: boolean): Promise<FoundGame[]> {
  const words = text.replace(/["\\]/g, ' ').trim()
  if (!words) return []
  const where = includeDlc ? '' : ` where game_type = ${MAIN_GAME_TYPES} & version_parent = null;`
  const games = await igdb<IgdbGame>(
    'games',
    `search "${words}"; fields name, first_release_date, cover.image_id, platforms.name, platforms.abbreviation;${where} limit 20;`,
  )
  return games.map(toFoundGame)
}

function toFoundGame(game: IgdbGame): FoundGame {
  return {
    igdbId: game.id,
    name: game.name,
    coverId: game.cover?.image_id,
    releaseDate: game.first_release_date ? game.first_release_date * 1000 : undefined,
    platforms: (game.platforms ?? []).map((p) => p.abbreviation || p.name),
  }
}

// Cover image from IGDB's image server. cover_small is 90 × 128 (the _2x version for sharp screens).
export function coverUrl(coverId: string, size: 'cover_small' | 'cover_big' = 'cover_small') {
  return `https://images.igdb.com/igdb/image/upload/t_${size}_2x/${coverId}.jpg`
}
