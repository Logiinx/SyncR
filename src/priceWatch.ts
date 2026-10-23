import { updateGame, type Game, type PriceWatch } from './db'
import type { GamePrices } from './prices'

// Price alerts of Watched games (set in the game window: PriceWatchView.tsx): which price a
// watch looks at, and when it alerts.

const cents = (price: string | null | undefined) => (price == null ? null : Math.round(Number(price) * 100))

// The watched price now, in cents (null: not sold there, or no key offer)
export function currentPrice(prices: GamePrices, store: PriceWatch['store']) {
  return store === 'steam' ? (prices.steam?.final ?? null) : cents(prices.deals?.keyshops)
}

// Its lowest price ever (GG.deals). Steam: the lowest of all official stores, as GG.deals has no
// Steam-only history (like the flame in the price lines)
export function lowestEver(prices: GamePrices, store: PriceWatch['store']) {
  return cents(store === 'steam' ? prices.deals?.retailLow : prices.deals?.keyshopsLow)
}

// The price that makes the watch alert: at or below it ('record': below it). null = not known.
export function alertPrice(watch: PriceWatch, prices: GamePrices | null | undefined) {
  if (watch.when === 'price') return watch.target ?? null
  if (watch.when === 'record') return watch.record ?? null
  return prices ? lowestEver(prices, watch.store) : null
}

// The price now when it should alert, else null
export function watchMet(watch: PriceWatch, prices: GamePrices) {
  const now = currentPrice(prices, watch.store)
  const limit = alertPrice(watch, prices)
  if (now === null || limit === null) return null
  return (watch.when === 'record' ? now < limit : now <= limit) ? now : null
}

// Sets the watch (again), or removes it (null). Every change starts a new watch: it can alert
// again. 'record' remembers today's lowest ever.
export function setWatch(game: Game, fields: Pick<PriceWatch, 'store' | 'when' | 'target'> | null, prices?: GamePrices | null) {
  if (!fields) return updateGame(game.id, { watch: undefined })
  const watch: PriceWatch = { ...fields, setAt: Date.now() }
  if (fields.target === undefined) delete watch.target
  if (fields.when === 'record' && prices) {
    const low = lowestEver(prices, fields.store)
    if (low !== null) watch.record = low
  }
  return updateGame(game.id, { watch })
}

// "Bought": the game moves to To play, its watch goes
export const markBought = (game: Game) => updateGame(game.id, { status: 'toplay', statusAt: Date.now(), watch: undefined })

// "12,5" or "12.50 €" → 1250 cents; null if it isn't a price
export function parseEuros(text: string) {
  const value = Number(text.replace('€', '').replace(',', '.').trim())
  return text.trim() && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null
}
