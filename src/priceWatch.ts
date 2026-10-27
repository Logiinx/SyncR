import { canWatch, db, updateGame, type EditionWatch, type Game, type PriceWatch } from './db'
import { formatEuros, gamePrices, lookupsAsked, type GamePrices } from './prices'
import { isComplete, loadConnection } from './igdb'
import { isConnected as googleConnected } from './google'
import { savePriceAlertEvent } from './calendarEvents'
import { gameId } from './games'
import { gameEditions } from './editions'

// Price alerts of To play and Waiting games (set in the game window: PriceWatchView.tsx): one
// target for the cheaper of Steam and the cheapest key, when it alerts, and the check (games.ts: after the first sync, then
// every hour, see startWatchChecks) that turns a reached price into a Google Calendar event.

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

// The price suggested when an alert is turned on, in whole euros, and where it came from: a third
// of the way from the lowest ever up to today's price (close to the low, still reachable when the
// low was a rare deep sale), but never more than 30% under today's price (a low can be a giveaway
// or a fluke: Fallout: New Vegas 0 € / 0,13 € key, which two prices can't tell from a real deep
// sale like Witcher 3's). No history (unknown to GG.deals): 30% under today's price. Never above
// today's price. Saving less than MIN_SAVING: no price (target null), it's already a good price
// (Fallout: New Vegas at 2,52 €). why: the dim line under the row. null: not sold now.
const MAX_DROP = 0.3
const MIN_SAVING = 200 // cents
export function suggestedTarget(prices: GamePrices): { target: number | null; why: string } | null {
  const now = currentPrice(prices)?.price
  if (now === undefined) return null
  const low = lowestEver(prices)
  const near = low === null ? 0 : low + (now - low) / 3
  const floor = now * (1 - MAX_DROP)
  const target = Math.min(Math.round(Math.max(near, floor) / 100) * 100, Math.floor(now / 100) * 100)
  if (now - target < MIN_SAVING) {
    // A 0 € low (a giveaway) says "free", like the price lines
    const lowText = low === null ? '' : ` (lowest ever ${low === 0 ? 'free' : formatEuros(low)})`
    return { target: null, why: `Already a good price${lowText}` }
  }
  const why = near >= floor ? `near the lowest ever (${formatEuros(low!)})` : '30% under today\'s price'
  return { target, why: `Suggested: ${why}` }
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

// Sets an edition's watch (again), or removes it (null), like setWatch. Reads the game again, so
// a quick change to another edition isn't lost.
export async function setEditionWatch(
  game: Game,
  edition: Pick<EditionWatch, 'kind' | 'id' | 'name'>,
  fields: Pick<PriceWatch, 'when' | 'target'> | null,
) {
  const current = (await db.games.get(game.id))?.editionWatches ?? []
  const list = current.filter((w) => !(w.kind === edition.kind && w.id === edition.id))
  if (fields) {
    const watch: EditionWatch = { kind: edition.kind, id: edition.id, name: edition.name, ...fields, setAt: Date.now() }
    if (fields.target === undefined) delete watch.target
    list.push(watch)
  }
  return updateGame(game.id, { editionWatches: list.length > 0 ? list : undefined })
}

// "Stop watching": the game and all its editions
export const stopWatching = (game: Game) => updateGame(game.id, { watch: undefined, editionWatches: undefined })

// ---------- The check ----------

// How often: as often as GG.deals' limit allows, so a check every 15 min to every hour. The
// checks of one device may use 250 lookups an hour: half of GG.deals' 1000 stays free (start
// lookup, lists, game windows), the rest is split with the other device. E.g. a check of up to
// 62 lookups: every 15 min; 125: every 30 min; 250 or more: every hour.
const FASTEST = 15 * 60 * 1000
const SLOWEST = 60 * 60 * 1000
const LOOKUPS_PER_HOUR = 250
const checkEvery = (lookups: number) =>
  Math.min(SLOWEST, Math.max(FASTEST, (lookups / LOOKUPS_PER_HOUR) * 60 * 60 * 1000))
const RETRY_IN = 15 * 60 * 1000 // after a failed check
const ALERT_IN = 5 * 60 * 1000 // the event starts (and alerts) this much later: see savePriceAlertEvent

// The Calendar event of one watch, "price<IGDB id>t<setAt>", "…e<Steam id>" for an edition
// (Google allows only 0-9 and a-v)
const priceEventId = (game: Game, watch: PriceWatch | EditionWatch) =>
  `price${game.igdbId}t${watch.setAt}${'kind' in watch ? `e${watch.id}` : ''}`
// The game of a price alert event ("igdb-..."), or null for other events
export function priceEventGame(eventId: string) {
  const match = eventId.match(/^price(\d+)t\d+(e\d+)?$/)
  return match ? gameId(Number(match[1])) : null
}

// What the event says: "Hollow Knight: 7,49 € on Steam" (or "for a key"; an edition: Steam's
// name for it), and why, with the shop's page
function alertText(name: string, watch: PriceWatch, { price, store }: { price: number; store: 'steam' | 'key' }, prices: GamePrices) {
  const why = watch.when === 'price' ? `Your price: ${formatEuros(watch.target!)} or less` : 'Its lowest price ever'
  const link = store === 'steam' ? prices.steamUrl : prices.deals?.url
  return {
    title: `${name}: ${formatEuros(price)} ${store === 'steam' ? 'on Steam' : 'for a key'}`,
    description: [why, link].filter(Boolean).join('\n'),
  }
}

// The event (with Google Calendar connected). Google unreachable: throws, nothing gets marked.
async function sendAlert(game: Game, watch: PriceWatch | EditionWatch, met: { price: number; store: 'steam' | 'key' }, prices: GamePrices) {
  if (!googleConnected()) return
  const name = 'kind' in watch ? watch.name : game.name
  await savePriceAlertEvent({ id: priceEventId(game, watch), start: Date.now() + ALERT_IN, ...alertText(name, watch, met, prices) })
}

const waiting = (watch?: PriceWatch) => !!watch && !watch.firedAt

// Every To play or Waiting game with a watch (its own or an edition's) that hasn't alerted yet:
// when its price is reached, the event is made and the watch marked as alerted, so it stays
// quiet until set again. Each edition alerts on its own. Google unreachable: nothing is
// marked, the next check tries again. false: it failed (offline, proxy or Google unreachable).
async function checkWatches(): Promise<boolean> {
  try {
    if (!isComplete(await loadConnection())) return true
    const games = await db.games
      .filter((g) => !g.deleted && canWatch(g) && (waiting(g.watch) || !!g.editionWatches?.some(waiting)))
      .toArray()
    if (games.length === 0) return true
    const allPrices = await gamePrices(games.filter((g) => waiting(g.watch)).map((g) => g.igdbId), { background: true })
    const allEditions = await gameEditions(games.filter((g) => g.editionWatches?.some(waiting)), { background: true })
    for (const game of games) {
      const watch = game.watch
      const prices = allPrices.get(game.igdbId)
      const met = waiting(watch) && prices ? watchMet(watch!, prices) : null
      if (met) {
        await sendAlert(game, watch!, met, prices!)
        await updateGame(game.id, { watch: { ...watch!, firedAt: Date.now(), firedPrice: met.price } })
      }
      for (const edition of game.editionWatches?.filter(waiting) ?? []) {
        const editionPrices = allEditions.get(game.igdbId)?.find((e) => e.kind === edition.kind && e.id === edition.id)?.prices
        const editionMet = editionPrices ? watchMet(edition, editionPrices) : null
        if (!editionMet) continue
        await sendAlert(game, edition, editionMet, editionPrices!)
        // Read again: the game's own alert (or another edition's) may have just been marked
        const list = (await db.games.get(game.id))?.editionWatches ?? []
        await updateGame(game.id, {
          editionWatches: list.map((w) =>
            w.kind === edition.kind && w.id === edition.id && w.setAt === edition.setAt
              ? { ...w, firedAt: Date.now(), firedPrice: editionMet.price }
              : w,
          ),
        })
      }
    }
    return true
  } catch (e) {
    console.warn('Price alert check failed', e)
    return false
  }
}

// When the checks run (started once by games.ts, after the first sync): now, then every 15 min
// to 1 hour (checkEvery); a failed one again after 15 min. Timers can be late (PC asleep, phone app in the background),
// so it also looks when the PC wakes up, the app comes back to the front or the internet returns,
// and checks if one is due.
let lastTry = 0
let lastOk = true
let lastLookups = Infinity // the last check's lookups (before the first one: as slow as can be)
let running = false
async function checkIfDue() {
  const wait = lastOk ? checkEvery(lastLookups) : RETRY_IN
  if (running || Date.now() - lastTry < wait) return
  running = true
  lastTry = Date.now()
  const before = lookupsAsked()
  try {
    lastOk = await checkWatches()
  } finally {
    // Prices a game window asked for just before are kept 10 min, so a check can count low once;
    // the next one counts right again
    lastLookups = lookupsAsked() - before
    running = false
  }
}

let started = false
export function startWatchChecks() {
  if (started) return
  started = true
  lastTry = 0
  checkIfDue()
  window.setInterval(checkIfDue, 5 * 60 * 1000) // after sleep it fires soon, so no long gaps
  window.addEventListener('focus', checkIfDue)
  window.addEventListener('online', checkIfDue)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && checkIfDue())
}

// "12,5" or "12.50 €" → 1250 cents; null if it isn't a price
export function parseEuros(text: string) {
  const value = Number(text.replace('€', '').replace(',', '.').trim())
  return text.trim() && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null
}
