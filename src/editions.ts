// A game's other editions on Steam (Deluxe, GOTY, Ultimate…): the purchase options of its Steam
// page, through our proxy's /editions route (proxy/igdb-worker.js). Only for games with a Steam
// game page; options whose name lacks the game's name (franchise bundles like "The Witcher
// Trilogy") are left out. Looked up live, never saved; a watched edition keeps its id and name.
import { canWatch, db } from './db'
import { igdbProxyFetch, isComplete, loadConnection } from './igdb'
import { nameFits, refKey, steamPrices, steamRefs, words, type GamePrices } from './prices'

export interface Edition {
  kind: 'sub' | 'bundle' // a package, or a bundle (several products sold together)
  id: number // Steam's package or bundle id
  name: string
  prices: GamePrices
}

type SteamPrice = GamePrices['steam']

// Kept a few minutes, so reopening a game window doesn't ask again
const CACHE_MS = 10 * 60_000
const cache = new Map<number, { editions: Edition[]; time: number }>()

// Editions by IGDB id (games without any: an empty list). Throws when the proxy can't be reached.
export async function gameEditions(games: { igdbId: number; name: string }[]): Promise<Map<number, Edition[]>> {
  const result = new Map<number, Edition[]>()
  const missing = games.filter((game) => {
    const cached = cache.get(game.igdbId)
    if (cached && Date.now() - cached.time < CACHE_MS) result.set(game.igdbId, cached.editions)
    return !result.has(game.igdbId)
  })
  if (missing.length === 0) return result
  const refs = await steamRefs(missing.map((g) => g.igdbId))
  const apps = new Map<number, number>() // Steam app id → IGDB id
  for (const [igdbId, ref] of refs) if (ref.kind === 'app') apps.set(ref.id, igdbId)

  const found: Record<string, { kind: Edition['kind']; id: number; name: string; steam: SteamPrice }[]> = {}
  const ids = [...apps.keys()]
  for (let i = 0; i < ids.length; i += 100) {
    const response = await igdbProxyFetch('editions', JSON.stringify({ steamIds: ids.slice(i, i + 100) }), 20_000)
    if (!response.ok) throw new Error(`Edition lookup failed (${response.status})`)
    Object.assign(found, await response.json())
  }
  // Their key price and lows from GG.deals (/prices). Packages: with Steam's price again.
  // Bundles: Steam's price stays the one from the game's page (Steam's own bundle lookup leaves
  // out today's discount).
  const options = missing.flatMap((game) => {
    const ref = refs.get(game.igdbId)
    const list = ref?.kind === 'app' ? found[ref.id] ?? [] : []
    return list.filter((o) => nameFits(game.name, o.name)).map((option) => ({ game, option }))
  })
  const known = await steamPrices(options.map(({ option }) => ({ kind: option.kind, id: option.id })))

  for (const game of missing) result.set(game.igdbId, [])
  for (const { game, option } of options) {
    const asked = known.get(refKey({ kind: option.kind, id: option.id }))
    const prices: GamePrices = option.kind === 'sub' && asked ? asked : {
      name: asked?.name ?? option.name,
      steamUrl: `https://store.steampowered.com/${option.kind}/${option.id}/`,
      steam: option.steam,
      deals: asked?.deals ?? null,
    }
    result.get(game.igdbId)!.push({ kind: option.kind, id: option.id, name: option.name, prices })
  }
  for (const game of missing) cache.set(game.igdbId, { editions: result.get(game.igdbId)!, time: Date.now() })
  return result
}

// The edition's name without the game's name in front: "ELDEN RING Shadow of the Erdtree
// Edition" → "Shadow of the Erdtree Edition" (all of it if nothing is left)
export function editionLabel(gameName: string, name: string) {
  const game = new Set(words(gameName))
  const parts = name.split(/\s+/)
  let start = 0
  while (start < parts.length && words(parts[start]).every((w) => game.has(w))) start++
  return parts.slice(start).join(' ') || name
}

// The last known editions of a game, however old: a game window shows them at once, then asks again
export const knownEditions = (igdbId: number) => cache.get(igdbId)?.editions

// Editions of all To play and Waiting games, once per start (games.ts, a minute after the
// prices, so both don't share GG.deals' per-minute limit). Quietly does nothing when it can't.
export async function loadListEditions() {
  try {
    if (!isComplete(await loadConnection())) return
    const games = await db.games.filter((g) => !g.deleted && canWatch(g)).toArray()
    if (games.length > 0) await gameEditions(games)
  } catch (e) {
    console.warn('Edition lookup failed', e)
  }
}
