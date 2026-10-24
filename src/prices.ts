// Game prices in euros: Steam's own price and the cheapest key (GG.deals), through our proxy's
// /prices route (proxy/igdb-worker.js). Looked up live, never saved or synced.
import { useEffect, useState } from 'react'
import { db } from './db'
import { igdb, igdbProxyFetch, isComplete, loadConnection } from './igdb'

export interface GamePrices {
  name?: string | null // the product the prices are for (GG.deals, else Steam's package name)
  steamUrl: string // the Steam store page (a game, or a package for some editions)
  steam: { final: number; initial: number; discount: number } | null // cents; null = free or not sold
  deals: {
    url: string // the game's GG.deals page
    retail: string | null // cheapest official store, e.g. "17.99"
    keyshops: string | null // cheapest key or gift that works in France
    retailLow: string | null // all-time lows
    keyshopsLow: string | null
  } | null
}

const STEAM = 1 // IGDB external game source

interface IgdbExternal {
  id: number
  external_games?: { uid?: string; external_game_source?: number; category?: number }[]
  websites?: { url?: string }[]
}

// Where a game is sold on Steam: a game page ("app"), or a package ("sub") for editions sold as
// a bundle of the game and its add-ons (e.g. Fallout: New Vegas Ultimate Edition)
export interface SteamRef {
  kind: 'app' | 'sub'
  id: number
}

// The Steam store page among the game's web links first (the current one: IGDB's other Steam
// links can be old pages, e.g. Fallout: New Vegas also lists a removed one), else IGDB's Steam
// link, else a package page (editions often have only that). Games not on Steam are left out.
function findSteam(game: IgdbExternal): SteamRef | undefined {
  const page = (kind: SteamRef['kind']) => {
    for (const site of game.websites ?? []) {
      const match = site.url?.match(new RegExp(`store\\.steampowered\\.com/${kind}/(\\d+)`))
      if (match) return { kind, id: Number(match[1]) }
    }
  }
  const linked = game.external_games?.find((e) => (e.external_game_source ?? e.category) === STEAM && Number(e.uid) > 0)
  return page('app') ?? (linked && { kind: 'app', id: Number(linked.uid) }) ?? page('sub')
}

// Do the prices fit the game? Every word of the game's name must be in the product's name, so a
// DLC or an edition priced as another product (IGDB linked the wrong Steam page) is caught.
// No name (proxy before v0.23): no warning.
const words = (name: string) =>
  name.toLowerCase().normalize('NFD').replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w) => w && !['the', 'a', 'of', 'and'].includes(w))
export function pricesFit(gameName: string, prices: GamePrices) {
  return !prices.name || nameFits(gameName, prices.name)
}
export function nameFits(gameName: string, productName: string) {
  const product = new Set(words(productName))
  return words(gameName).every((w) => product.has(w))
}

export async function steamRefs(igdbIds: number[]): Promise<Map<number, SteamRef>> {
  const result = new Map<number, SteamRef>()
  for (let i = 0; i < igdbIds.length; i += 500) {
    const ids = igdbIds.slice(i, i + 500)
    const games = await igdb<IgdbExternal>(
      'games',
      `fields external_games.uid, external_games.external_game_source, external_games.category, websites.url; where id = (${ids.join(',')}); limit 500;`,
    )
    for (const game of games) {
      const steam = findSteam(game)
      if (steam) result.set(game.id, steam)
    }
  }
  return result
}

// Kept a few minutes, so opening a game right after the start lookup doesn't ask again
const CACHE_MS = 10 * 60_000
const cache = new Map<number, { prices: GamePrices | null; time: number }>()

// Per request: GG.deals allows 100 games (and 100 per minute); Steam answers one package at a time
const MAX_APPS = 100
const MAX_SUBS = 20

// Prices by IGDB id; null = not on Steam
export async function gamePrices(igdbIds: number[]): Promise<Map<number, GamePrices | null>> {
  const result = new Map<number, GamePrices | null>()
  const missing = igdbIds.filter((id) => {
    const cached = cache.get(id)
    if (cached && Date.now() - cached.time < CACHE_MS) result.set(id, cached.prices)
    return !result.has(id)
  })
  if (missing.length === 0) return result
  const steam = await steamRefs(missing)
  const found = await steamPrices([...steam.values()])
  for (const id of missing) {
    const ref = steam.get(id)
    result.set(id, ref ? found.get(refKey(ref)) ?? null : null)
    cache.set(id, { prices: result.get(id)!, time: Date.now() })
  }
  listeners.forEach((listener) => listener())
  return result
}

export const refKey = (ref: SteamRef) => `${ref.kind}${ref.id}`

// Prices of Steam pages (games and packages), by refKey; null = not known. No cache.
export async function steamPrices(refs: SteamRef[]): Promise<Map<string, GamePrices | null>> {
  const result = new Map<string, GamePrices | null>()
  let batch: SteamRef[] = []
  const ask = async () => {
    const body = {
      steamIds: batch.filter((r) => r.kind === 'app').map((r) => r.id),
      subIds: batch.filter((r) => r.kind === 'sub').map((r) => r.id),
    }
    const response = await igdbProxyFetch('prices', JSON.stringify(body), 20_000)
    if (!response.ok) throw new Error(`Price lookup failed (${response.status})`)
    const answer: Record<string, Omit<GamePrices, 'steamUrl'>> = await response.json()
    for (const ref of batch) {
      const found = answer[ref.kind === 'app' ? ref.id : `sub${ref.id}`]
      result.set(refKey(ref), found ? { steamUrl: `https://store.steampowered.com/${ref.kind}/${ref.id}/`, ...found } : null)
    }
    batch = []
  }
  for (const ref of refs) {
    if (result.has(refKey(ref)) || batch.some((b) => refKey(b) === refKey(ref))) continue // asked already
    batch.push(ref)
    const kinds = batch.map((b) => b.kind)
    if (kinds.filter((k) => k === 'app').length === MAX_APPS || kinds.filter((k) => k === 'sub').length === MAX_SUBS) await ask()
  }
  if (batch.length > 0) await ask()
  return result
}

// The lists show only what's already known (no lookup of their own); they update when new prices arrive
const listeners = new Set<() => void>()

export function useKnownPrice(igdbId: number): GamePrices | null | undefined {
  const [, setVersion] = useState(0)
  useEffect(() => {
    const listener = () => setVersion((v) => v + 1)
    listeners.add(listener)
    return () => void listeners.delete(listener)
  }, [])
  return cache.get(igdbId)?.prices
}

// The games that show prices in the lists: To play, and watched Waiting games (pre-orders)
export const hasPriceLine = (game: { status: string; watch?: object }) =>
  game.status === 'toplay' || (game.status === 'waiting' && !!game.watch)

// Prices of all those games at once: at start (games.ts) and when the To play or Waiting list
// opens. Only those older than CACHE_MS are asked again. Quietly does nothing when it can't.
export async function loadListPrices() {
  try {
    if (!isComplete(await loadConnection())) return
    const games = await db.games.filter((g) => hasPriceLine(g) && !g.deleted).toArray()
    if (games.length > 0) await gamePrices(games.map((g) => g.igdbId))
  } catch (e) {
    console.warn('Price lookup failed', e)
  }
}

// "17,99 €" from cents or from GG.deals' "17.99"
export function formatEuros(value: number | string): string {
  const euros = typeof value === 'number' ? value / 100 : Number(value)
  return euros.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
}

// One game's prices for the game windows: undefined while loading, null when there's nothing
// to show (not on Steam, game search not set up, offline)
export function useGamePrices(igdbId: number): GamePrices | null | undefined {
  const [prices, setPrices] = useState<GamePrices | null | undefined>(undefined)
  useEffect(() => {
    let current = true
    setPrices(undefined)
    loadConnection()
      .then((connection) => (isComplete(connection) ? gamePrices([igdbId]) : null))
      .then((result) => current && setPrices(result?.get(igdbId) ?? null))
      .catch(() => current && setPrices(null))
    return () => {
      current = false
    }
  }, [igdbId])
  return prices
}
