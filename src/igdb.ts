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

// ---------- Calendar: upcoming PC games ----------

// A game in the calendar: its first PC release inside the calendar's range
export interface UpcomingGame extends FoundGame {
  pcDate: number // ms
  exact: boolean // false: only a month, quarter or year is known ("Q1 2027")
  monthOnly: boolean // only the month is known ("Nov 2026")
  vagueLabel: string // IGDB's text for a vague date, e.g. "Nov 2026", "Q1 2027", "2026"
  rank: number // place in Steam's most wishlisted upcoming games (1 = most wishlisted)
}

const PC = 6 // IGDB platform id of PC (Microsoft Windows)
const MOST_WISHLISTED = 10 // IGDB popularity type: Steam's "Most Wishlisted Upcoming"
export const POPULAR_MAX = 1000 // the calendar can show up to Steam's top 1000 wishlisted
export const CALENDAR_MONTHS = 6

interface IgdbReleaseDate {
  date?: number // seconds
  date_format?: number // 0 = exact day
  platform?: number
  human?: string
  status?: { name?: string }
}

interface IgdbUpcoming extends IgdbGame {
  release_dates?: IgdbReleaseDate[]
}

// IGDB also lists Alpha, Beta, Early Access, Advanced Access (early play for pre-orders),
// Offline and Cancelled dates. Only the real release counts (most entries have no status).
function isFullRelease(release: IgdbReleaseDate) {
  return !release.status || release.status.name === 'Full Release'
}

// The calendar's range: from today (midnight) to 6 months later, in ms
export function calendarRange() {
  const start = new Date().setHours(0, 0, 0, 0)
  const end = new Date(start).setMonth(new Date(start).getMonth() + CALENDAR_MONTHS)
  return { start, end }
}

function toUpcoming(game: IgdbGame, pc: IgdbReleaseDate, rank: number): UpcomingGame {
  return {
    ...toFoundGame(game),
    pcDate: pc.date! * 1000,
    exact: !pc.date_format, // 0 = exact day
    monthOnly: pc.date_format === 1,
    vagueLabel: pc.human ?? '',
    rank,
  }
}

const byDate = (a: UpcomingGame, b: UpcomingGame) => a.pcDate - b.pcDate || a.name.localeCompare(b.name)

// Popular upcoming PC games: Steam's top 1000 most wishlisted, keeping those with a PC release
// between today and 6 months from now. Each game keeps its rank, so the calendar can show the
// top 100 / 300 / 500 / 1000 without asking again. Requests of 500 (IGDB's limit): the ranking,
// then the games themselves. A vague date counts at its end: "2026" is 31 Dec 2026, "Q1 2027"
// is 31 Mar 2027.
const PAGE = 500

export async function popularUpcoming(): Promise<UpcomingGame[]> {
  const ranking: { game_id: number }[] = []
  for (let offset = 0; offset < POPULAR_MAX; offset += PAGE) {
    ranking.push(
      ...(await igdb<{ game_id: number }>(
        'popularity_primitives',
        `fields game_id; where popularity_type = ${MOST_WISHLISTED}; sort value desc; limit ${PAGE}; offset ${offset};`,
      )),
    )
  }
  const rank = new Map(ranking.map((r, i) => [r.game_id, i + 1]))
  const { start, end } = calendarRange()
  const upcoming: UpcomingGame[] = []
  for (let offset = 0; offset < ranking.length; offset += PAGE) {
    const ids = ranking.slice(offset, offset + PAGE).map((r) => r.game_id)
    const games = await igdb<IgdbUpcoming>(
      'games',
      `fields name, first_release_date, cover.image_id, platforms.name, platforms.abbreviation, release_dates.date, release_dates.date_format, release_dates.platform, release_dates.human, release_dates.status.name; where id = (${ids.join(',')}) & game_type = ${MAIN_GAME_TYPES} & version_parent = null; limit ${PAGE};`,
    )
    for (const game of games) {
      const pc = (game.release_dates ?? [])
        .filter((r) => r.platform === PC && isFullRelease(r) && r.date && r.date * 1000 >= start && r.date * 1000 < end)
        .sort((a, b) => a.date! - b.date!)[0]
      if (pc) upcoming.push(toUpcoming(game, pc, rank.get(game.id)!))
    }
  }
  return upcoming.sort(byDate)
}

// Cover image from IGDB's image server. cover_small is 90 × 128 (the _2x version for sharp screens).
export function coverUrl(coverId: string, size: 'cover_small' | 'cover_big' = 'cover_small') {
  return `https://images.igdb.com/igdb/image/upload/t_${size}_2x/${coverId}.jpg`
}
