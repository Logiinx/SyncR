import { db, updateGame, type Game, type PriceWatch } from './db'
import { formatEuros, gamePrices, type GamePrices } from './prices'
import { isComplete, loadConnection } from './igdb'
import { isConnected as googleConnected } from './google'
import { savePriceAlertEvent } from './calendarEvents'
import { gameId } from './games'

// Price alerts of Watched games (set in the game window: PriceWatchView.tsx): which price a
// watch looks at, when it alerts, and the check (games.ts: after the first sync, then every
// CHECK_EVERY) that turns a reached price into a Google Calendar event (its alert card has
// "Bought": dueReminders.ts).

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

// What the event says: "Hollow Knight: 7,49 € on Steam", and why, with the shop's page
function alertText(game: Game, watch: PriceWatch, price: number, prices: GamePrices) {
  const why =
    watch.when === 'price' ? `Your price: ${formatEuros(watch.target!)} or less`
    : watch.when === 'low' ? 'Its lowest price ever'
    : `Below its lowest ever (${formatEuros(watch.record!)})`
  const link = watch.store === 'steam' ? prices.steamUrl : prices.deals?.url
  return {
    title: `${game.name}: ${formatEuros(price)} ${watch.store === 'steam' ? 'on Steam' : 'for a key'}`,
    description: [why, link].filter(Boolean).join('\n'),
  }
}

// Every Watched game with a watch that hasn't alerted yet: when its price is reached, the event
// is made (with Google Calendar connected) and the watch marked as alerted, so it stays quiet
// until set again. Google unreachable: nothing is marked, the next check tries again.
export async function checkWatches() {
  try {
    if (!isComplete(await loadConnection())) return
    const games = await db.games.filter((g) => !g.deleted && g.status === 'watched' && !!g.watch && !g.watch.firedAt).toArray()
    if (games.length === 0) return
    const allPrices = await gamePrices(games.map((g) => g.igdbId))
    for (const game of games) {
      const watch = game.watch!
      const prices = allPrices.get(game.igdbId)
      if (!prices) continue
      // "Below lowest ever" set before the prices were known: today's lowest ever counts
      if (watch.when === 'record' && watch.record === undefined) {
        const low = lowestEver(prices, watch.store)
        if (low !== null) await updateGame(game.id, { watch: { ...watch, record: low } })
        continue
      }
      const price = watchMet(watch, prices)
      if (price === null) continue
      if (googleConnected()) {
        await savePriceAlertEvent({ id: priceEventId(game, watch), start: Date.now() + ALERT_IN, ...alertText(game, watch, price, prices) })
      }
      await updateGame(game.id, { watch: { ...watch, firedAt: Date.now(), firedPrice: price } })
    }
  } catch (e) {
    console.warn('Price alert check failed', e)
  }
}

// "Bought": the game moves to To play, its watch goes
export const markBought = (game: Game) => updateGame(game.id, { status: 'toplay', statusAt: Date.now(), watch: undefined })

// "12,5" or "12.50 €" → 1250 cents; null if it isn't a price
export function parseEuros(text: string) {
  const value = Number(text.replace('€', '').replace(',', '.').trim())
  return text.trim() && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null
}
