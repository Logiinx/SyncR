import { useEffect, useRef, useState } from 'react'
import { Bell, BellOff, BellRing, ExternalLink } from 'lucide-react'
import type { Game, PriceWatch } from './db'
import { shortDate } from './dates'
import { openLink } from './links'
import { formatEuros, useKnownPrice } from './prices'
import { alertPrice, currentPrice, parseEuros, setWatch } from './priceWatch'

// The "Price alert" part of a To play or Waiting game's window (GameDialog.tsx): when to alert
// (Off = not watched) on the cheaper of Steam and the cheapest key, what it looks like now,
// "Stop watching" and a link to the game's GG.deals page to set an alert there too (store
// filters, bundles, subscriptions). Uses the prices the window already loaded (GamePricesInfo).
// Without prices (not on Steam, no prices for this connection) it says so.

type When = PriceWatch['when'] | 'off'
const WHEN: [When, string][] = [
  ['off', 'Off'],
  ['price', 'At my price'],
  ['low', 'At lowest ever'],
  ['record', 'Below lowest ever'],
]

// A watched game in the Games grid and list: a bell, ringing (accent) once the price was reached
export function WatchBell({ watch }: { watch: PriceWatch }) {
  return watch.firedAt ? (
    <span className="watch-bell reached" title="Price reached">
      <BellRing size={12} />
    </span>
  ) : (
    <span className="watch-bell" title="Price watched">
      <Bell size={12} />
    </span>
  )
}

const euroText = (cents?: number) => (cents === undefined ? '' : (cents / 100).toFixed(2).replace('.', ','))

// focus: opened by "Watch price…": scrolled into view, "Alert when" focused (after the window
// focused itself, so Escape still closes it)
export function PriceWatchView({ game, focus }: { game: Game; focus?: boolean }) {
  const prices = useKnownPrice(game.igdbId)
  const watch = game.watch
  const whenRef = useRef<HTMLSelectElement>(null)
  useEffect(() => {
    if (!focus) return
    const timer = window.setTimeout(() => {
      whenRef.current?.scrollIntoView({ block: 'nearest' })
      whenRef.current?.focus({ preventScroll: true })
    })
    return () => window.clearTimeout(timer)
  }, [focus])
  const [target, setTarget] = useState(euroText(watch?.target))
  const when: When = watch?.when ?? 'off'

  const save = (change: { when?: When; target?: number }) => {
    const next = { when, target: watch?.target, ...change }
    if (next.when === 'off') return setWatch(game, null)
    return setWatch(game, { when: next.when, target: next.target }, prices)
  }

  const now = prices ? currentPrice(prices) : null
  const limit = watch && alertPrice(watch, prices)
  const canWatch = !!prices || !!watch

  return (
    <div className="gd-field">
      <span>Price alert</span>
      {canWatch && (
        <div className="event-options watch-options">
          <label>
            <span>Alert when</span>
            <select ref={whenRef} value={when} onChange={(e) => save({ when: e.target.value as When })}>
              {WHEN.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {when === 'price' && (
            <label>
              <span>My price (€)</span>
              <input
                inputMode="decimal"
                value={target}
                placeholder={now !== null ? euroText(now.price) : ''}
                onChange={(e) => {
                  setTarget(e.target.value)
                  const cents = parseEuros(e.target.value)
                  if (cents !== null) save({ target: cents })
                }}
              />
            </label>
          )}
        </div>
      )}
      {watch?.firedAt ? (
        <p className="watch-state">
          Reached {shortDate(watch.firedAt)}
          {watch.firedPrice !== undefined && `: ${formatEuros(watch.firedPrice)}`}
          <button className="watch-again" onClick={() => save({})}>
            Watch again
          </button>
        </p>
      ) : (
        watch && (
          <p className="watch-state">
            {now !== null ? `Now ${formatEuros(now.price)} ${now.store === 'steam' ? 'on Steam' : 'for a key'}` : 'Not sold now'}
            {limit != null && ` · alerts ${watch.when === 'record' ? `below ${formatEuros(limit)}` : `at ${formatEuros(limit)} or less`}`}
          </p>
        )
      )}
      {prices === null && !watch && <p className="watch-state">No prices known for this game</p>}
      <div className="watch-actions">
        {watch && (
          <button className="gd-action" onClick={() => setWatch(game, null)}>
            <BellOff size={15} /> <span>Stop watching</span>
          </button>
        )}
        {prices?.deals && (
          <button
            className="gd-action"
            onClick={() => openLink(prices.deals!.url)}
            title="Open its GG.deals page, to set an alert there (stores, bundles, subscriptions)"
          >
            <ExternalLink size={15} /> <span>GG.deals alert</span>
          </button>
        )}
      </div>
    </div>
  )
}
