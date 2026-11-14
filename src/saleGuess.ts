// A guess of a game's next Steam sale: Steam's next big seasonal sale (from Valve's page) and how
// the game was discounted over the last 2 years (IsThereAnyDeal), through our proxy's /sales route
// (proxy/igdb-worker.js). Asked only when shown (hover on a Steam price, the game window), kept
// in memory for this session, never saved or synced. Information only: price alerts don't use it.
import { useEffect, useState } from 'react'
import { capitalize, t } from './i18n'
import { dayMonth, shortDate } from './dates'
import { igdbProxyFetch, isComplete, loadConnection } from './igdb'
import type { GamePrices } from './prices'

interface BigSale {
  name: string // Valve's English name, e.g. "Winter Sale"
  start: string // "YYYY-MM-DD", first day
  end: string // last day (included)
}
interface PriceChange {
  at: number // ms
  price: number // cents
  regular: number
  cut: number // %, 0 = full price
}
interface SalesAnswer {
  bigSales: BigSale[]
  history: PriceChange[] | null // null: not on IsThereAnyDeal (or no key in the proxy)
}

const DAY = 24 * 60 * 60 * 1000
const YEAR = 365 * DAY
const AROUND = 7 * DAY // "at that time last year": a sale starting up to a week before or after

export interface SaleGuess {
  // Steam's next (or current) big sale; undefined when none is announced
  bigSale?: { name: string; start: number; end: number; now: boolean }
  // Only when the history is known:
  history?: {
    never: boolean // no discount in the last 2 years
    lastYear?: number // the best discount around this big sale's dates a year ago (0 = none);
    //                   undefined: no big sale announced, or the game's history doesn't go that far
    usual?: number // its most common discount (from 2 sales)
    last?: { at: number; cut: number } // its last sale that has ended
  }
}

// "YYYY-MM-DD" as a local day, ms (its start)
function dayStart(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

// The game's sales: from a change with a discount to the next one at full price. The best
// discount of the stretch counts (a sale can deepen while it runs).
function salesOf(history: PriceChange[]) {
  const sales: { start: number; end: number | null; cut: number }[] = []
  for (const change of history) {
    const open = sales.at(-1)?.end === null ? sales.at(-1)! : null
    if (change.cut > 0) {
      if (open) open.cut = Math.max(open.cut, change.cut)
      else sales.push({ start: change.at, end: null, cut: change.cut })
    } else if (open) open.end = change.at
  }
  return sales
}

// The guess from the proxy's answer; now: today (a parameter, to test it with other dates)
export function makeGuess(answer: SalesAnswer, now = Date.now()): SaleGuess {
  const today = new Date(now).setHours(0, 0, 0, 0)
  const next = answer.bigSales
    .map((sale) => ({ name: sale.name, start: dayStart(sale.start), end: dayStart(sale.end) + DAY - 1 }))
    .filter((sale) => sale.end >= now)
    .sort((a, b) => a.start - b.start)[0]
  const guess: SaleGuess = next ? { bigSale: { ...next, now: next.start <= now } } : {}
  if (!answer.history) return guess
  const sales = salesOf(answer.history)
  if (sales.length === 0) return { ...guess, history: { never: true } }
  // Most common discount (from 2 sales: with one, "last on sale" says it already); a tie goes to
  // the most recent
  const counts = new Map<number, number>()
  for (const sale of sales) counts.set(sale.cut, (counts.get(sale.cut) ?? 0) + 1)
  let usual = sales.at(-1)!.cut
  for (const sale of [...sales].reverse()) if (counts.get(sale.cut)! > counts.get(usual)!) usual = sale.cut
  const ended = sales.filter((sale) => sale.end !== null).at(-1)
  let lastYear: number | undefined
  const known = answer.history[0].at
  if (next && known <= next.start - YEAR - AROUND) {
    const from = next.start - YEAR - AROUND
    const to = Math.min(next.end - YEAR + AROUND, today)
    lastYear = Math.max(0, ...sales.filter((sale) => sale.start <= to && (sale.end ?? now) >= from).map((sale) => sale.cut))
  }
  return {
    ...guess,
    history: { never: false, lastYear, usual: sales.length > 1 ? usual : undefined, last: ended && { at: ended.start, cut: ended.cut } },
  }
}

// ---------- Asking the proxy ----------

const answers = new Map<number, Promise<SalesAnswer | null>>() // by Steam app id, this session

// The Steam app of the prices (packages and bundles have no history on IsThereAnyDeal here)
export const steamAppOf = (prices: GamePrices) => Number(prices.steamUrl.match(/\/app\/(\d+)\//)?.[1] ?? 0) || null

function loadSales(appId: number) {
  let answer = answers.get(appId)
  if (!answer) {
    answer = (async () => {
      if (!isComplete(await loadConnection())) return null
      const response = await igdbProxyFetch('sales', JSON.stringify({ steamId: appId }), 20_000)
      if (!response.ok) throw new Error(`Proxy answered ${response.status}`) // i18n-ok: never shown
      return (await response.json()) as SalesAnswer
    })()
    // A failed ask (offline, IsThereAnyDeal busy) is asked again next time
    answer.catch(() => answers.delete(appId))
    answers.set(appId, answer)
  }
  return answer.catch(() => null)
}

// The guess for a game's prices, asked once active (hovered, or shown in the game window):
// undefined while loading (or not active yet), null when there's nothing to show
export function useSaleGuess(prices: GamePrices | null | undefined, active: boolean): SaleGuess | null | undefined {
  const appId = prices ? steamAppOf(prices) : null
  const [guess, setGuess] = useState<{ appId: number; guess: SaleGuess | null } | undefined>(undefined)
  useEffect(() => {
    if (!active || !appId || guess?.appId === appId) return
    let current = true
    loadSales(appId).then((answer) => {
      if (!current) return
      const made = answer && makeGuess(answer)
      setGuess({ appId, guess: made && (made.bigSale || made.history) ? made : null })
    })
    return () => {
      current = false
    }
  }, [active, appId, guess?.appId])
  if (!appId) return null
  return guess?.appId === appId ? guess.guess : undefined
}

// ---------- Its words ----------

// Valve's sale names in the app's language (another name shows as Valve wrote it, after "Steam")
function saleName(name: string) {
  const names: Record<string, () => string> = {
    'Winter Sale': () => t('Steam Winter Sale'),
    'Spring Sale': () => t('Steam Spring Sale'),
    'Summer Sale': () => t('Steam Summer Sale'),
    'Autumn Sale': () => t('Steam Autumn Sale'),
  }
  return names[name]?.() ?? `Steam ${name}` // i18n-ok: Valve's own name
}

// The big sale as short pieces, each kept on one line (the line wraps only between them):
// ["Steam Winter Sale: 17 Dec – 4 Jan", "in 33 days"] (no years: it's the coming one), or one
// piece "Steam Winter Sale until 4 Jan" / "No big Steam sale announced yet"
export function bigSaleParts(guess: SaleGuess, now = Date.now()): string[] {
  const sale = guess.bigSale
  if (!sale) return [t('No big Steam sale announced yet')]
  const name = saleName(sale.name)
  if (sale.now) return [t('{sale} until {date}', { sale: name, date: dayMonth(sale.end) })]
  const days = Math.round((sale.start - new Date(now).setHours(0, 0, 0, 0)) / DAY)
  return [
    t('{sale}: {dates}', { sale: name, dates: `${dayMonth(sale.start)} – ${dayMonth(sale.end)}` }),
    days <= 1 ? t('tomorrow') : t('in {n} days', { n: days }),
  ]
}

// The game's own pieces: ["Last year: −40%", "usually −40%", "last sale 12 Aug 2026 (−35%)"]
// (the first one capitalized; "last year" = around this big sale's dates); null without history
export function gameSaleParts(guess: SaleGuess): string[] | null {
  const history = guess.history
  if (!history) return null
  if (history.never) return [t('No Steam discount in the last 2 years')]
  const parts = [
    history.lastYear === undefined
      ? null
      : history.lastYear > 0
        ? t('Last year: −{cut}%', { cut: history.lastYear })
        : t('Last year: no discount'),
    history.usual && t('usually −{cut}%', { cut: history.usual }),
    history.last && t('last sale {date} (−{cut}%)', { date: shortDate(history.last.at), cut: history.last.cut }),
  ].filter(Boolean) as string[]
  return parts.length > 0 ? [capitalize(parts[0]), ...parts.slice(1)] : null
}
