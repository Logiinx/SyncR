import { canWatch, db, updateGame, type Game, type PriceWatch } from './db'
import { formatEuros, gamePrices, type GamePrices } from './prices'
import { isComplete, loadConnection } from './igdb'
import { isConnected as googleConnected } from './google'
import { savePriceAlertEvent } from './calendarEvents'
import { gameId } from './games'

// Price alerts of To play and Waiting games (set in the game window: PriceWatchView.tsx): one
// target for the cheaper of Steam and the cheapest key, when it alerts, and the check (games.ts: after the first sync, then
// every CHECK_EVERY) that turns a reached price into a Google Calendar event.

const cents = (price: string | null | undefined) => (price == null ? null : Math.round(Number(price) * 100))

// The cheaper of Steam and the cheapest key now, in cents, and where (equal: Steam, the safer
// buy, like the price lines). null: neither is sold.
export function currentPrice(prices: GamePrices): { price: number; store: 'steam' | 'key' } | null {
  const steam = prices.steam?.final ?? null
  const key = cents(prices.deals?.keyshops)
  if (steam !== null && (key === null || steam <= key)) return { price: steam, store: 'steam' }
  return key !== null ? { price: key, store: 'key' } : null
}

// The lowest price ever of either (GG.deals). Steam's is the lowest of all official stores, as
// GG.deals has no Steam-only history (like the flame in the price lines)
export function lowestEver(prices: GamePrices) {
  const lows = [cents(prices.deals?.retailLow), cents(prices.deals?.keyshopsLow)].filter((low) => low !== null)
  return lows.length > 0 ? Math.min(...lows) : null
}

// The price that makes the watch alert: at or below it. null = not known. Anything but 'price'
// is "at lowest ever" (also an old 'record' watch).
export function alertPrice(watch: PriceWatch, prices: GamePrices | null | undefined) {
  if (watch.when === 'price') return watch.target ?? null
  return prices ? lowestEver(prices) : null
}

// The price now (and where) when it should alert, else null
export function watchMet(watch: PriceWatch, prices: GamePrices) {
  const now = currentPrice(prices)
  const limit = alertPrice(watch, prices)
  if (now === null || limit === null) return null
  return now.price <= limit ? now : null
}

// Sets the watch (again), or removes it (null). Every change starts a new watch: it can alert
// again.
export function setWatch(game: Game, fields: Pick<PriceWatch, 'when' | 'target'> | null) {
  if (!fields) return updateGame(game.id, { watch: undefined })
  const watch: PriceWatch = { ...fields, setAt: Date.now() }
  if (fields.target === undefined) delete watch.target
  return updateGame(game.id, { watch })
}

// ---------- The check ----------

export const CHECK_EVERY = 6 * 60 * 60 * 1000
const ALERT_IN = 5 * 60 * 1000 // the event starts (and alerts) this much later: see savePriceAlertEvent

// The Calendar event of one watch, "price<IGDB id>t<setAt>" (Google allows only 0-9 and a-v)
const priceEventId = (game: Game, watch: PriceWatch) => `price${game.igdbId}t${watch.setAt}`
// The game of a price alert event ("igdb-..."), or null for other events
export function priceEventGame(eventId: string) {
  const match = eventId.match(/^price(\d+)t\d+$/)
  return match ? gameId(Number(match[1])) : null
}

// What the event says: "Hollow Knight: 7,49 € on Steam" (or "for a key"), and why, with the
// shop's page
function alertText(game: Game, watch: PriceWatch, { price, store }: { price: number; store: 'steam' | 'key' }, prices: GamePrices) {
  const why = watch.when === 'price' ? `Your price: ${formatEuros(watch.target!)} or less` : 'Its lowest price ever'
  const link = store === 'steam' ? prices.steamUrl : prices.deals?.url
  return {
    title: `${game.name}: ${formatEuros(price)} ${store === 'steam' ? 'on Steam' : 'for a key'}`,
    description: [why, link].filter(Boolean).join('\n'),
  }
}

// Every To play or Waiting game with a watch that hasn't alerted yet: when its price is reached, the event
// is made (with Google Calendar connected) and the watch marked as alerted, so it stays quiet
// until set again. Google unreachable: nothing is marked, the next check tries again.
export async function checkWatches() {
  try {
    if (!isComplete(await loadConnection())) return
    const games = await db.games.filter((g) => !g.deleted && canWatch(g) && !!g.watch && !g.watch.firedAt).toArray()
    if (games.length === 0) return
    const allPrices = await gamePrices(games.map((g) => g.igdbId))
    for (const game of games) {
      const watch = game.watch!
      const prices = allPrices.get(game.igdbId)
      if (!prices) continue
      const met = watchMet(watch, prices)
      if (met === null) continue
      if (googleConnected()) {
        await savePriceAlertEvent({ id: priceEventId(game, watch), start: Date.now() + ALERT_IN, ...alertText(game, watch, met, prices) })
      }
      await updateGame(game.id, { watch: { ...watch, firedAt: Date.now(), firedPrice: met.price } })
    }
  } catch (e) {
    console.warn('Price alert check failed', e)
  }
}

// "12,5" or "12.50 €" → 1250 cents; null if it isn't a price
export function parseEuros(text: string) {
  const value = Number(text.replace('€', '').replace(',', '.').trim())
  return text.trim() && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null
}
