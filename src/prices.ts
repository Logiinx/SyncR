// Game prices in euros: Steam's own price and the cheapest key (GG.deals), through our proxy's
// /prices route (proxy/igdb-worker.js). Looked up live, never saved or synced.
import { useEffect, useState } from 'react'
import { db } from './db'
import { igdb, igdbProxyFetch, isComplete, loadConnection } from './igdb'

export interface GamePrices {
  steamId: number
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
}

// IGDB id → Steam app id (games not on Steam are left out)
async function steamIds(igdbIds: number[]): Promise<Map<number, number>> {
  const result = new Map<number, number>()
  for (let i = 0; i < igdbIds.length; i += 500) {
    const ids = igdbIds.slice(i, i + 500)
    const games = await igdb<IgdbExternal>(
      'games',
      `fields external_games.uid, external_games.external_game_source, external_games.category; where id = (${ids.join(',')}); limit 500;`,
    )
    for (const game of games) {
      const steam = game.external_games?.find((e) => (e.external_game_source ?? e.category) === STEAM && Number(e.uid) > 0)
      if (steam) result.set(game.id, Number(steam.uid))
    }
  }
  return result
}

// Kept a few minutes, so opening a game right after the start lookup doesn't ask again
const CACHE_MS = 10 * 60_000
const cache = new Map<number, { prices: GamePrices | null; time: number }>()

// Prices by IGDB id; null = not on Steam. GG.deals allows 100 games per request (and per minute).
export async function gamePrices(igdbIds: number[]): Promise<Map<number, GamePrices | null>> {
  const result = new Map<number, GamePrices | null>()
  const missing = igdbIds.filter((id) => {
    const cached = cache.get(id)
    if (cached && Date.now() - cached.time < CACHE_MS) result.set(id, cached.prices)
    return !result.has(id)
  })
  if (missing.length === 0) return result
  const steam = await steamIds(missing)
  const withSteam = missing.filter((id) => steam.has(id))
  for (let i = 0; i < withSteam.length; i += 100) {
    const part = withSteam.slice(i, i + 100)
    const response = await igdbProxyFetch('prices', JSON.stringify({ steamIds: part.map((id) => steam.get(id)) }), 20_000)
    if (!response.ok) throw new Error(`Price lookup failed (${response.status})`)
    const answer: Record<string, Omit<GamePrices, 'steamId'>> = await response.json()
    for (const id of part) {
      const steamId = steam.get(id)!
      const found = answer[steamId]
      result.set(id, found ? { steamId, ...found } : null)
    }
  }
  for (const id of missing) {
    if (!result.has(id)) result.set(id, null)
    cache.set(id, { prices: result.get(id)!, time: Date.now() })
  }
  listeners.forEach((listener) => listener())
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

// Prices of all "To play" games at once: at start (games.ts) and when the To play list opens.
// Only those older than CACHE_MS are asked again. Quietly does nothing when it can't.
export async function loadToPlayPrices() {
  try {
    if (!isComplete(await loadConnection())) return
    const games = await db.games.filter((g) => g.status === 'toplay' && !g.deleted).toArray()
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
