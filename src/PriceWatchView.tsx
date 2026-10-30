import { useEffect, useRef, useState, type RefObject } from 'react'
import { Bell, BellOff, BellRing, ExternalLink, PackageCheck } from 'lucide-react'
import type { Game, PriceWatch } from './db'
import { shortDate } from './dates'
import { openLink } from './links'
import { editionLabel, gameEditions, knownEditions, type Edition } from './editions'
import { formatEuros, useKnownPrice, type GamePrices } from './prices'
import { alertPrice, currentPrice, parseEuros, setEditionWatch, setWatch, stopWatching, suggestedTarget } from './priceWatch'

// The "Price alerts" part of a To buy or Upcoming game's window (GameDialog.tsx): per row (the
// game, its editions) a bell turns the alert on or off, then when to alert on the cheaper of Steam
// and the cheapest key, what it looks like now,
// "Stop watching" and a link to the game's GG.deals page to set an alert there too (store
// filters, bundles, subscriptions). Uses the prices the window already loaded (GamePricesInfo).
// Without prices (not on Steam, no prices for this connection) it says so.

const WHEN: [PriceWatch['when'], string][] = [
  ['price', 'At my price'],
  ['low', 'At lowest ever'],
]

// A watched game (or edition) in the Games grid and list: a round badge on the cover's left
// corner (the check/trophy badge has the right one), a bell, ringing and green once a price was
// reached. Hover: one line per alert ("Alert at ≤ 10,00 €", "Deluxe Edition: alert at ≤ 25,00 €",
// "· reached 9,50 €" once it rang).
// A pre-ordered Upcoming game: a green box in the same corner (it never has a bell)
export function PreorderBadge() {
  return <span className="game-badge preorder" title="Pre-ordered"><PackageCheck /></span>
}

export function WatchBell({ game }: { game: Game }) {
  const watches = [
    ...(game.watch ? [{ watch: game.watch as PriceWatch, name: '' }] : []),
    ...(game.editionWatches ?? []).map((watch) => ({ watch, name: editionLabel(game.name, watch.name) })),
  ]
  const lines = watches.map(({ watch, name }) => {
    const alert =
      watch.when === 'price' ? (watch.target !== undefined ? `alert at ≤ ${formatEuros(watch.target)}` : 'alert at my price')
      : 'alert at lowest ever'
    const reached = watch.firedAt ? ` · reached${watch.firedPrice !== undefined ? ` ${formatEuros(watch.firedPrice)}` : ''}` : ''
    const line = `${alert}${reached}`
    return name ? `${name}: ${line}` : line[0].toUpperCase() + line.slice(1)
  })
  return watches.some(({ watch }) => watch.firedAt) ? (
    <span className="game-badge watch reached" title={lines.join('\n')}>
      <BellRing />
    </span>
  ) : (
    <span className="game-badge watch" title={lines.join('\n')}>
      <Bell />
    </span>
  )
}

const euroText = (cents?: number) => (cents === undefined ? '' : (cents / 100).toFixed(2).replace('.', ','))
const nowText = (now: ReturnType<typeof currentPrice>) =>
  now !== null ? `${formatEuros(now.price)} ${now.store === 'steam' ? 'on Steam' : 'for a key'}` : 'Not sold now'

type WatchFields = Pick<PriceWatch, 'when' | 'target'>

// "Price alerts" in a To buy or Upcoming game's window: one list, the game first, then its
// other editions on Steam (editions.ts), each row with its own alert (an edition is watched only
// when the user sets one). The editions known from the start lookup show at once and are asked
// again quietly; before any are known a dim line keeps their place, so nothing jumps.
// focus: opened by "Watch price…": scrolled into view, the game's bell focused (after the
// window focused itself, so Escape still closes it).
export function PriceWatchView({ game, focus }: { game: Game; focus?: boolean }) {
  const prices = useKnownPrice(game.igdbId)
  const watch = game.watch
  const whenRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!focus) return
    const timer = window.setTimeout(() => {
      whenRef.current?.scrollIntoView({ block: 'nearest' })
      whenRef.current?.focus({ preventScroll: true })
    })
    return () => window.clearTimeout(timer)
  }, [focus])

  // Only games with a Steam game page have editions. undefined: not known (yet).
  const [editions, setEditions] = useState<Edition[] | undefined>(() => knownEditions(game.igdbId))
  const [looking, setLooking] = useState(false)
  const hasAppPage = !!prices?.steamUrl.includes('/app/')
  useEffect(() => {
    if (!hasAppPage) return
    let current = true
    setLooking(true)
    gameEditions([{ igdbId: game.igdbId, name: game.name }])
      .then((found) => current && setEditions(found.get(game.igdbId)))
      .catch(() => {}) // offline: the known ones (or none)
      .finally(() => current && setLooking(false))
    return () => {
      current = false
    }
  }, [hasAppPage, game.igdbId, game.name])
  // Watched editions Steam no longer lists stay, without a price (while not known yet: no price text)
  const watched = game.editionWatches ?? []
  const editionRows = [
    ...(editions ?? []),
    ...watched
      .filter((w) => !editions?.some((e) => e.kind === w.kind && e.id === w.id))
      .map((w) => ({ kind: w.kind, id: w.id, name: w.name, prices: editions ? null : undefined })),
  ]

  const canWatch = !!prices || !!watch
  const watchingAny = !!watch || watched.length > 0

  return (
    <div className="gd-field">
      <span>Price alerts</span>
      {canWatch && (
        <WatchRow
          name={game.name}
          note={editionRows.length > 0 ? '(base game)' : undefined}
          watch={watch}
          prices={prices}
          whenRef={whenRef}
          onSave={(fields) => setWatch(game, fields)}
        />
      )}
      {prices === null && !watch && <p className="watch-state">No prices known for this game</p>}
      {editionRows.map((edition) => (
        <WatchRow
          key={`${edition.kind}${edition.id}`}
          name={editionLabel(game.name, edition.name)}
          title={edition.name}
          watch={watched.find((w) => w.kind === edition.kind && w.id === edition.id)}
          prices={edition.prices}
          noHistory={!!edition.prices && !edition.prices.deals}
          onSave={(fields) => setEditionWatch(game, edition, fields)}
        />
      ))}
      {editions === undefined && (looking || prices === undefined) && <p className="watch-state watch-looking">Looking for editions…</p>}
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

// One row of the list (the game or an edition): a bell that turns its alert on (at my price,
// filled with a suggested price (priceWatch.ts) unless one was typed, or left empty with "Already
// a good price"; the cursor in the box) or off, its name, its price now and the alert ("· alerts at ≤
// 10,00 €", or "· reached 24 Oct: 9,50 €" with Watch again and a ringing green bell), and while on,
// when to alert and my price. prices null: not sold on Steam now. noHistory: GG.deals doesn't know it, so
// no "At lowest ever".
function WatchRow({ name, note, title, watch, prices, noHistory, whenRef, onSave }: {
  name: string
  note?: string // dim, after the name
  title?: string // the full name, on hover
  watch?: PriceWatch
  prices: GamePrices | null | undefined
  noHistory?: boolean
  whenRef?: RefObject<HTMLButtonElement | null>
  onSave: (fields: WatchFields | null) => void
}) {
  const [target, setTarget] = useState(euroText(watch?.target))
  const priceRef = useRef<HTMLInputElement>(null)
  const [focusPrice, setFocusPrice] = useState(false)
  useEffect(() => {
    if (focusPrice && watch) {
      priceRef.current?.focus()
      setFocusPrice(false)
    }
  }, [focusPrice, watch])
  const when = !watch ? null : watch.when === 'price' || noHistory ? 'price' : 'low' // an old 'record' watch: 'low'
  const save = (change: Partial<WatchFields>) =>
    onSave({ when: when ?? 'price', target: watch?.target, ...change })
  const now = prices ? currentPrice(prices, watch?.ignoredKeys) : null
  const limit = watch && alertPrice(watch, prices)
  // Where the suggested price came from, shown until the price is changed
  const [suggested, setSuggested] = useState<string | null>(null)
  const toggle = () => {
    if (watch) return onSave(null)
    setFocusPrice(true)
    const typed = parseEuros(target)
    const suggestion = typed === null && prices ? suggestedTarget(prices) : null
    if (suggestion) {
      if (suggestion.target !== null) setTarget(euroText(suggestion.target))
      setSuggested(suggestion.why)
    }
    save({ target: typed ?? suggestion?.target ?? undefined })
  }

  return (
    <div className={watch ? 'watch-row on' : 'watch-row'}>
      <button
        ref={whenRef}
        className={watch?.firedAt ? 'watch-toggle reached' : watch ? 'watch-toggle on' : 'watch-toggle'}
        onClick={toggle}
        aria-pressed={!!watch}
        title={watch ? 'Stop this alert' : 'Alert me when the price drops'}
      >
        {watch?.firedAt ? <BellRing size={15} /> : <Bell size={15} />}
      </button>
      <div className="watch-row-name">
        <span title={title ?? name}>
          {name}
          {note && <span className="watch-row-note"> {note}</span>}
        </span>
        <span>
          {prices === null ? 'Not on Steam now' : prices === undefined ? '' : nowText(now)}
          {watch?.firedAt ? (
            <>
              {` · reached ${shortDate(watch.firedAt)}${watch.firedPrice !== undefined ? `: ${formatEuros(watch.firedPrice)}` : ''}`}
              <button className="watch-again" onClick={() => save({})}>
                Watch again
              </button>
            </>
          ) : (
            limit != null && ` · alerts at ≤ ${formatEuros(limit)}`
          )}
        </span>
        {watch?.ignoredKeys && (
          <span title="Marked “Wrong key” on an alert (turn the alert off and on to forget them)">
            Ignoring keys at {watch.ignoredKeys.map(formatEuros).join(', ')}
          </span>
        )}
        {suggested && when === 'price' && <span>{suggested}</span>}
      </div>
      {when && (
        <div className="watch-row-choices">
          <select value={when} aria-label="Alert when" onChange={(e) => save({ when: e.target.value as PriceWatch['when'] })}>
            {WHEN.map(([value, label]) => (
              <option key={value} value={value} disabled={noHistory && value === 'low'}>
                {label}
              </option>
            ))}
          </select>
          {when === 'price' && (
            <input
              ref={priceRef}
              inputMode="decimal"
              value={target}
              aria-label="My price (€)"
              placeholder="€"
              onChange={(e) => {
                setTarget(e.target.value)
                setSuggested(null)
                const cents = parseEuros(e.target.value)
                if (cents !== null) save({ target: cents })
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}
