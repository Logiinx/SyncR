import { useLiveQuery } from 'dexie-react-hooks'
import { changed, db } from './db'
import { read } from './localState'

// Game data from IGDB, through SyncR's own proxy (proxy/igdb-worker.js, a Cloudflare Worker):
// IGDB can't be called from a web page directly and needs a secret that can't be in the app.
// The proxy's address and password are set in Settings and synced to all devices (a synced
// setting, encrypted like everything else in Dropbox).

export interface IgdbConnection {
  url: string // e.g. https://syncr-igdb.<name>.workers.dev
  password: string
}

const SETTING = 'igdb-proxy' // lower case: Dropbox lists file names in lower case
const EMPTY: IgdbConnection = { url: '', password: '' }

export async function loadConnection(): Promise<IgdbConnection> {
  const row = await db.settings.get(SETTING)
  return (row?.value as IgdbConnection | undefined) ?? EMPTY
}

// Keeps what sync knows about the last synced version (syncedRev, …)
export async function saveConnection(connection: IgdbConnection) {
  const change = { value: connection, updatedAt: Date.now() }
  if (!(await db.settings.update(SETTING, change))) await db.settings.put({ name: SETTING, ...change })
  changed()
}

// Up to v0.11.0 the connection was kept per device (localStorage "igdb"). Moves it into the
// synced setting once, if there's none yet. Called at start (App, via startGameChecks).
export async function moveOldConnection() {
  const old = read<IgdbConnection>('igdb', EMPTY)
  if (old.url && !(await db.settings.get(SETTING))) await saveConnection(old)
  localStorage.removeItem('igdb')
}

export const isComplete = (connection?: IgdbConnection) => !!connection?.url && !!connection.password

// For the UI: the connection, updated when it changes (also from sync). undefined while loading.
export function useConnection() {
  return useLiveQuery(loadConnection, [])
}

// The address as typed, made absolute: without "https://" the browser would treat it as a
// path inside SyncR's own site (and get SyncR's page back instead of game data)
function proxyUrl(typed: string) {
  const url = typed.trim().replace(/\/+$/, '')
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

// One IGDB query, e.g. igdb('games', 'search "Guild Wars"; fields name; limit 5;')
// connection: to check one that isn't saved yet (Settings); otherwise the saved one.
export async function igdb<T>(endpoint: string, query: string, connection?: IgdbConnection): Promise<T[]> {
  connection ??= await loadConnection()
  if (!isComplete(connection)) throw new Error('Game search is not set up (Settings → Games)')
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

// ---------- Games and their release dates ----------

// A game as found in IGDB, before it's in the list
export interface FoundGame {
  igdbId: number
  name: string
  coverId?: string
  releaseDate?: number // ms, exact day only (see trackedRelease)
  releaseLabel?: string // a vague date instead, e.g. "Q1 2027"; neither = not announced (TBA)
  platforms: string[]
}

interface IgdbReleaseDate {
  date?: number // seconds
  date_format?: number // 0 = exact day, 1 = month, 2 = year, 3–6 = quarter, 7 = TBD
  platform?: number
  human?: string
  status?: { name?: string }
}

interface IgdbGame {
  id: number
  name: string
  first_release_date?: number // seconds
  cover?: { image_id: string }
  platforms?: { name: string; abbreviation?: string }[]
  release_dates?: IgdbReleaseDate[]
}

// Everything SyncR reads about a game, in one request
const GAME_FIELDS =
  'name, first_release_date, cover.image_id, platforms.name, platforms.abbreviation, release_dates.date, release_dates.date_format, release_dates.platform, release_dates.human, release_dates.status.name'

// IGDB game types: main game 0, standalone expansion 4, remake 8, remaster 9,
// expanded game 10, port 11. Left out unless asked: DLC 1, expansion 2, bundle 3, mod 5,
// episode 6, season 7, fork 12, pack 13, update 14. Editions ("Gold Edition") have a version_parent.
const MAIN_GAME_TYPES = '(0,4,8,9,10,11)'

const PC = 6 // IGDB platform ids
const ANDROID = 34
const PAGE = 500 // IGDB's maximum per request

// IGDB also lists Alpha, Beta, Early Access, Advanced Access (early play for pre-orders),
// Offline and Cancelled dates. Only the real release counts (most entries have no status).
function isFullRelease(release: IgdbReleaseDate) {
  return !release.status || release.status.name === 'Full Release'
}

// The release date SyncR follows: the PC release if the game comes to PC, else Android, else
// the first release on any other platform (consoles). Full releases only. An exact day gives
// releaseDate; a vague one ("Q1 2027") only a label, so it never counts as "out".
function trackedRelease(game: IgdbGame): Pick<FoundGame, 'releaseDate' | 'releaseLabel'> {
  const full = (game.release_dates ?? []).filter((r) => isFullRelease(r) && (r.date || r.human))
  if (full.length === 0) {
    return game.first_release_date ? { releaseDate: game.first_release_date * 1000 } : {}
  }
  const onPlatform = [PC, ANDROID].map((p) => full.filter((r) => r.platform === p)).find((list) => list.length > 0)
  // Earliest first; entries without a date (TBD) last
  const first = [...(onPlatform ?? full)].sort((a, b) => (a.date ?? Infinity) - (b.date ?? Infinity))[0]
  if (first.date && !first.date_format) return { releaseDate: first.date * 1000 }
  return first.human && first.human !== 'TBD' ? { releaseLabel: first.human } : {}
}

const SEARCH_LIMIT = 50 // matches fetched per query, to have popular ones to sort
const SEARCH_SHOWN = 20
const WANT_TO_PLAY = 2 // IGDB popularity types
const VISITS = 1

// "Cronos: The New Dawn" → ['cronos', 'the', 'new', 'dawn'] (punctuation ignored)
const nameWords = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)

// Two queries, because IGDB's own search only matches whole words ("Cronos the new d" finds
// nothing): its search, plus names containing every typed word, each as the start of a word
// in the name (so a word still being typed counts). Exact names first, then most popular.
export async function searchGames(text: string, includeDlc: boolean): Promise<FoundGame[]> {
  const typed = nameWords(text)
  if (typed.length === 0) return []
  const filter = includeDlc ? [] : [`game_type = ${MAIN_GAME_TYPES}`, 'version_parent = null']
  const searchWhere = filter.length ? ` where ${filter.join(' & ')};` : ''
  const nameWhere = [...typed.map((word) => `name ~ *"${word}"*`), ...filter].join(' & ')
  const [bySearch, byName] = await Promise.all([
    igdb<IgdbGame>('games', `search "${typed.join(' ')}"; fields ${GAME_FIELDS};${searchWhere} limit ${SEARCH_LIMIT};`),
    igdb<IgdbGame>('games', `fields ${GAME_FIELDS}; where ${nameWhere}; sort hypes desc; limit ${SEARCH_LIMIT};`),
  ])
  const startsWords = (game: IgdbGame) => {
    const words = nameWords(game.name)
    return typed.every((t) => words.some((w) => w.startsWith(t)))
  }
  const games = new Map<number, IgdbGame>()
  for (const game of [...bySearch, ...byName.filter(startsWords)]) games.set(game.id, game)

  const score = await popularity([...games.keys()])
  const exact = (game: IgdbGame) => (nameWords(game.name).join(' ') === typed.join(' ') ? 1 : 0)
  const rank = (game: IgdbGame) => [exact(game), score.get(game.id)?.wantToPlay ?? 0, score.get(game.id)?.visits ?? 0]
  return [...games.values()]
    .sort((a, b) => {
      const [ra, rb] = [rank(a), rank(b)]
      return rb[0] - ra[0] || rb[1] - ra[1] || rb[2] - ra[2]
    })
    .slice(0, SEARCH_SHOWN)
    .map(toFoundGame)
}

// IGDB's popularity scores: "Want to Play" ranks best (also covers upcoming games),
// visits break ties. Without them (request failed) the results keep IGDB's order.
async function popularity(ids: number[]) {
  const score = new Map<number, { wantToPlay?: number; visits?: number }>()
  if (ids.length === 0) return score
  try {
    const rows = await igdb<{ game_id: number; popularity_type: number; value: number }>(
      'popularity_primitives',
      `fields game_id, popularity_type, value; where game_id = (${ids.join(',')}) & popularity_type = (${WANT_TO_PLAY},${VISITS}); limit ${PAGE};`,
    )
    for (const row of rows) {
      const entry = score.get(row.game_id) ?? {}
      if (row.popularity_type === WANT_TO_PLAY) entry.wantToPlay = row.value
      else entry.visits = row.value
      score.set(row.game_id, entry)
    }
  } catch {
    // keep the order without popularity
  }
  return score
}

// Fresh data for games already in the list (the daily refresh, games.ts)
export async function fetchGames(igdbIds: number[]): Promise<FoundGame[]> {
  const found: FoundGame[] = []
  for (let offset = 0; offset < igdbIds.length; offset += PAGE) {
    const ids = igdbIds.slice(offset, offset + PAGE)
    const games = await igdb<IgdbGame>('games', `fields ${GAME_FIELDS}; where id = (${ids.join(',')}); limit ${PAGE};`)
    found.push(...games.map(toFoundGame))
  }
  return found
}

function toFoundGame(game: IgdbGame): FoundGame {
  return {
    igdbId: game.id,
    name: game.name,
    coverId: game.cover?.image_id,
    ...trackedRelease(game),
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

const MOST_WISHLISTED = 10 // IGDB popularity type: Steam's "Most Wishlisted Upcoming"
export const POPULAR_MAX = 1000 // the calendar can show up to Steam's top 1000 wishlisted
export const CALENDAR_MONTHS = 6

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
    const games = await igdb<IgdbGame>(
      'games',
      `fields ${GAME_FIELDS}; where id = (${ids.join(',')}) & game_type = ${MAIN_GAME_TYPES} & version_parent = null; limit ${PAGE};`,
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
