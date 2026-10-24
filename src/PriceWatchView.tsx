import { useEffect, useRef, useState, type RefObject } from 'react'
import { Bell, BellOff, BellRing, ExternalLink } from 'lucide-react'
import type { Game, PriceWatch } from './db'
import { shortDate } from './dates'
import { openLink } from './links'
import { editionLabel, gameEditions, type Edition } from './editions'
import { formatEuros, useKnownPrice, type GamePrices } from './prices'
import { alertPrice, currentPrice, parseEuros, setEditionWatch, setWatch, stopWatching } from './priceWatch'

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
]

// A watched game in the Games grid and list: a round badge on the cover's left corner (the
// check/trophy badge has the right one), a bell, ringing and green once the price was reached.
// Hover: the alert that's set ("Alert at ≤ 10,00 €"), and the price that made it ring.
export function WatchBell({ watch }: { watch: PriceWatch }) {
  const alert =
    watch.when === 'price' ? (watch.target !== undefined ? `Alert at ≤ ${formatEuros(watch.target)}` : 'Alert at my price')
    : 'Alert at lowest ever'
  return watch.firedAt ? (
    <span
      className="game-badge watch reached"
      title={`Price reached${watch.firedPrice !== undefined ? `: ${formatEuros(watch.firedPrice)}` : ''}\n${alert}`}
    >
      <BellRing />
    </span>
  ) : (
    <span className="game-badge watch" title={alert}>
      <Bell />
    </span>
  )
}

const euroText = (cents?: number) => (cents === undefined ? '' : (cents / 100).toFixed(2).replace('.', ','))
const nowText = (now: ReturnType<typeof currentPrice>) =>
  now !== null ? `${formatEuros(now.price)} ${now.store === 'steam' ? 'on Steam' : 'for a key'}` : 'Not sold now'

type WatchFields = Pick<PriceWatch, 'when' | 'target'>

// focus: opened by "Watch price…": scrolled into view, "Alert when" focused (after the window
// focused itself, so Escape still closes it). Under the game's own alert, its other editions on
// Steam (editions.ts), each with its own alert, only when the user sets one.
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

  // Only games with a Steam game page have editions. undefined: not known (yet).
  const [editions, setEditions] = useState<Edition[]>()
  const hasAppPage = !!prices?.steamUrl.includes('/app/')
  useEffect(() => {
    if (!hasAppPage) return
    let current = true
    gameEditions([{ igdbId: game.igdbId, name: game.name }])
      .then((found) => current && setEditions(found.get(game.igdbId)))
      .catch(() => {}) // offline: no editions shown
    return () => {
      current = false
    }
  }, [hasAppPage, game.igdbId, game.name])
  // Watched editions Steam no longer lists stay, without a price
  const watched = game.editionWatches ?? []
  const editionRows = [
    ...(editions ?? []),
    ...(editions ? watched.filter((w) => !editions.some((e) => e.kind === w.kind && e.id === w.id)) : watched)
      .map((w) => ({ kind: w.kind, id: w.id, name: w.name, prices: null })),
  ]

  const canWatch = !!prices || !!watch
  const watchingAny = !!watch || watched.length > 0

  return (
    <div className="gd-field">
      <span>Price alert</span>
      {canWatch && (
        <WatchControls
          watch={watch}
          prices={prices}
          whenRef={whenRef}
          onSave={(fields) => setWatch(game, fields)}
        />
      )}
      {prices === null && !watch && <p className="watch-state">No prices known for this game</p>}
      {editionRows.length > 0 && (
        <div className="watch-editions">
          <span>Editions on Steam</span>
          {editionRows.map((edition) => {
            const editionWatch = watched.find((w) => w.kind === edition.kind && w.id === edition.id)
            return (
              <div key={`${edition.kind}${edition.id}`} className="watch-edition">
                <p className="watch-edition-name">
                  <span title={edition.name}>{editionLabel(game.name, edition.name)}</span>
                  <span>{edition.prices ? nowText(currentPrice(edition.prices)) : 'Not on Steam now'}</span>
                </p>
                <WatchControls
                  watch={editionWatch}
                  prices={edition.prices}
                  bundle={edition.kind === 'bundle'}
                  compact
                  onSave={(fields) => setEditionWatch(game, edition, fields)}
                />
              </div>
            )
          })}
        </div>
      )}
      <div className="watch-actions">
        {watchingAny && (
          <button className="gd-action" onClick={() => stopWatching(game)}>
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

// One alert (the game's or an edition's): when, my price, and its state ("Now … · alerts at …",
// or "Reached … · Watch again"). compact: an edition's row, without the labels (its price is
// on the line above). bundle: no price history, so no "At lowest ever".
function WatchControls({ watch, prices, bundle, compact, whenRef, onSave }: {
  watch?: PriceWatch
  prices: GamePrices | null | undefined
  bundle?: boolean
  compact?: boolean
  whenRef?: RefObject<HTMLSelectElement | null>
  onSave: (fields: WatchFields | null) => void
}) {
  const [target, setTarget] = useState(euroText(watch?.target))
  const when: When = !watch ? 'off' : watch.when === 'price' || bundle ? 'price' : 'low' // an old 'record' watch: 'low'
  const save = (change: { when?: When; target?: number }) => {
    const next = { when, target: watch?.target, ...change }
    onSave(next.when === 'off' ? null : { when: next.when, target: next.target })
  }
  const now = prices ? currentPrice(prices) : null
  const limit = watch && alertPrice(watch, prices)

  return (
    <>
      <div className="event-options watch-options">
        <label>
          {!compact && <span>Alert when</span>}
          <select ref={whenRef} value={when} aria-label="Alert when" onChange={(e) => save({ when: e.target.value as When })}>
            {WHEN.map(([value, label]) => (
              <option key={value} value={value} disabled={bundle && value === 'low'}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {when === 'price' && (
          <label>
            {!compact && <span>My price (€)</span>}
            <input
              inputMode="decimal"
              value={target}
              aria-label="My price (€)"
              placeholder={compact ? 'My price (€)' : now !== null ? euroText(now.price) : ''}
              onChange={(e) => {
                setTarget(e.target.value)
                const cents = parseEuros(e.target.value)
                if (cents !== null) save({ target: cents })
              }}
            />
          </label>
        )}
      </div>
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
            {compact ? '' : `Now ${nowText(now)}`}
            {limit != null && `${compact ? 'Alerts' : ' · alerts'} at ${formatEuros(limit)} or less`}
          </p>
        )
      )}
    </>
  )
}
