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

// One IGDB query, e.g. igdb('games', 'search "Guild Wars"; fields name; limit 5;')
export async function igdb<T>(endpoint: string, query: string, connection = loadConnection()): Promise<T[]> {
  if (!connection.url || !connection.password) throw new Error('Game search is not set up (Settings → Games)')
  let response: Response
  try {
    response = await fetch(`${connection.url.replace(/\/+$/, '')}/${endpoint}`, {
      method: 'POST',
      headers: { 'X-SyncR-Password': connection.password },
      body: query,
    })
  } catch {
    throw new Error('Could not reach the game search proxy (offline, or wrong address?)')
  }
  if (response.status === 401) throw new Error('Wrong password for the game search proxy')
  if (!response.ok) throw new Error(`Game search failed (${response.status}): ${await response.text()}`)
  return response.json()
}
