// A guess of a game's next Steam sale: Steam's next big seasonal sale (from Valve's page) and how
// the game was discounted over the last 2 years (IsThereAnyDeal), through our proxy's /sales route
// (proxy/igdb-worker.js). Asked only when shown (hover on a Steam price, the game window), kept
// in memory for this session, never saved or synced. Price alerts only show it as a hint by the
// price (PriceWatchView), they don't act on it.
import { useEffect, useState } from 'react'
import { t, textKey, type TextKey } from './i18n'
import { dayMonth, shortDate } from './dates'
import { igdbProxyFetch, isComplete, loadConnection } from './igdb'
import type { GamePrices } from './prices'

interface BigSale {
  name: string // Valve's English name, e.g. "Winter Sale"
  start: string // "YYYY-MM-DD", first day
  end: string // last day (included)
  official?: false // Black Friday: publishers' own discounts, not a Steam sale
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
  // Black Friday (not a Steam sale), only while it comes before that big sale
  deals?: { start: number; end: number; now: boolean }
  // Only when the history is known:
  history?: {
    never: boolean // no discount in the last 2 years
    lastYear?: number // the best discount around this big sale's dates a year ago (0 = none);
    //                   undefined: no big sale announced, or the game's history doesn't go that far
    usual?: number // its most common discount (from 2 sales)
    usualSeen?: number // how many of its sales had that discount
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
  const coming = answer.bigSales
    .map((sale) => ({ name: sale.name, official: sale.official !== false, start: dayStart(sale.start), end: dayStart(sale.end) + DAY - 1 }))
    .filter((sale) => sale.end >= now)
    .sort((a, b) => a.start - b.start)
  const found = coming.find((sale) => sale.official)
  const next = found && { name: found.name, start: found.start, end: found.end }
  const friday = coming.find((sale) => !sale.official && (!next || sale.start < next.start))
  const guess: SaleGuess = {}
  if (next) guess.bigSale = { ...next, now: next.start <= now }
  if (friday) guess.deals = { start: friday.start, end: friday.end, now: friday.start <= now }
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
    history: { never: false, lastYear, usual: sales.length > 1 ? usual : undefined, usualSeen: counts.get(usual), last: ended && { at: ended.start, cut: ended.cut } },
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
      setGuess({ appId, guess: made && (made.bigSale || made.deals || made.history) ? made : null })
    })
    return () => {
      current = false
    }
  }, [active, appId, guess?.appId])
  if (!appId) return null
  return guess?.appId === appId ? guess.guess : undefined
}


// ---------- The estimated sale price ----------

export interface SaleEstimate {
  cut: number // %
  price: number // cents
  from: 'lastYear' | 'usual'
}

// The price the next sale would likely give, from Steam's normal price (today's may already be a
// sale): the game's discount around that sale a year ago, else its usual one (only when it had it
// at least twice). Rounded up to the cent, so an alert at that price still rings if Steam rounds
// up. null: no discount to go by, or the big sale is on now (its price shows already).
export function estimateSale(guess: SaleGuess, regular: number): SaleEstimate | null {
  const history = guess.history
  if (!history || history.never || guess.bigSale?.now) return null
  const priced = (cut: number, from: SaleEstimate['from']) => ({ cut, price: Math.ceil((regular * (100 - cut)) / 100), from })
  if (history.lastYear) return priced(history.lastYear, 'lastYear')
  if (history.usual && (history.usualSeen ?? 0) >= 2) return priced(history.usual, 'usual')
  return null
}

// ---------- Its words ----------

// A run of text: its values (dates, discounts) show bright, the words around them dim, like the
// HowLongToBeat times; discounts green, like the price's sale
export type SalePiece = { text: string; value?: boolean; discount?: boolean }[]

const MARK = '\u0001'
// The text of a key with its values as bright segments (discounts: names of values that are one)
function piece(key: TextKey, values: Record<string, string> = {}, discounts: string[] = []): SalePiece {
  const marks = Object.fromEntries(Object.keys(values).map((name) => [name, `${MARK}${name}${MARK}`]))
  return t(key, marks)
    .split(MARK)
    .map((text, i) => (i % 2 ? { text: values[text], value: true, discount: discounts.includes(text) } : { text }))
    .filter((segment) => segment.text)
}
export const discountText = (cut: number) => t('−{n}%', { n: cut })

// Valve's sale names in the app's language (another name shows as Valve wrote it, after "Steam")
export function saleName(name: string) {
  const names: Record<string, () => string> = {
    'Winter Sale': () => t('Steam Winter Sale'),
    'Spring Sale': () => t('Steam Spring Sale'),
    'Summer Sale': () => t('Steam Summer Sale'),
    'Autumn Sale': () => t('Steam Autumn Sale'),
  }
  return names[name]?.() ?? `Steam ${name}` // i18n-ok: Valve's own name
}

// "in 33 days" / "tomorrow"
function whenText(start: number, now: number) {
  const days = Math.round((start - new Date(now).setHours(0, 0, 0, 0)) / DAY)
  return days <= 1 ? t('tomorrow') : t('in {n} days', { n: days })
}
// "17 Dec – 4 Jan", or "26–30 Nov" within one month (no years: it's the coming one)
function datesText(sale: { start: number; end: number }) {
  const [start, end] = [new Date(sale.start), new Date(sale.end)]
  if (start.getMonth() === end.getMonth()) return `${start.getDate()}–${dayMonth(sale.end)}`
  return `${dayMonth(sale.start)} – ${dayMonth(sale.end)}`
}

// The table (GameExtrasView SaleTable), a row per sale, then the game's own:
//   Black Friday ¹      26–30 Nov       in 12 days      (only while it comes first)
//   Steam Winter Sale   17 Dec – 4 Jan  in 33 days      ("on now" while it runs)
//   This game           −40% → ≈ 14,70 €  last year     (the estimate and where it comes from)
//                       usually −40% · last sale 12 Aug 2026 (−35%)
//   ¹ not a Steam sale
// No big sale announced: a dim row saying so. The game's row only when its history is known.
export interface SaleRow {
  name: string
  dates: string
  when: string
  now: boolean
  notSteam?: boolean // Black Friday: publishers' own discounts
}
export interface SaleTable {
  sales: SaleRow[]
  noBigSale: boolean
  game?: {
    never?: boolean // no discount in the last 2 years
    estimate?: SaleEstimate
    facts: SalePiece[] // "usually −40%", "last sale 12 Aug 2026 (−35%)"…
  }
}

export function saleTable(guess: SaleGuess, regular: number | null, now = Date.now()): SaleTable {
  const sales: SaleRow[] = []
  for (const [sale, name, notSteam] of [
    [guess.deals, t('Black Friday'), true],
    [guess.bigSale, guess.bigSale && saleName(guess.bigSale.name), false],
  ] as const) {
    if (sale && name) sales.push({ name, dates: datesText(sale), when: sale.now ? t('on now') : whenText(sale.start, now), now: sale.now, notSteam })
  }
  const table: SaleTable = { sales, noBigSale: !guess.bigSale }
  const history = guess.history
  if (history?.never) table.game = { never: true, facts: [] }
  else if (history) {
    const estimate = regular ? estimateSale(guess, regular) : null
    const facts = [
      history.lastYear !== undefined &&
        estimate?.from !== 'lastYear' &&
        (history.lastYear > 0 ? piece(textKey('last year {cut}'), { cut: discountText(history.lastYear) }, ['cut']) : piece(textKey('no discount last year'))),
      history.usual && estimate?.from !== 'usual' && piece(textKey('usually {cut}'), { cut: discountText(history.usual) }, ['cut']),
      history.last && piece(textKey('last sale {date} ({cut})'), { date: shortDate(history.last.at), cut: discountText(history.last.cut) }, ['cut']),
    ].filter(Boolean) as SalePiece[]
    if (estimate || facts.length > 0) table.game = { estimate: estimate ?? undefined, facts }
  }
  return table
}
