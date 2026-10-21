import { useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight, Flame, KeyRound, Play } from 'lucide-react'
import CloseButton from './CloseButton'
import { useGameExtras } from './gameExtras'
import { openLink } from './links'
import Spinner from './Spinner'
import { formatEuros, useGamePrices, useKnownPrice, type GamePrices } from './prices'

// The extra details in the game windows (gameExtras.ts): developer, publisher, game modes, and
// the trailer (a button that opens a panel beside the window). Nothing shows when they can't
// load (offline, game search not set up).

export function GameExtrasInfo({ igdbId }: { igdbId: number }) {
  const extras = useGameExtras(igdbId)
  if (extras === undefined) return <Spinner />
  if (!extras) return null
  const lines: [string, string[]][] = [
    ['Developer', extras.developers],
    ['Publisher', extras.publishers],
    ['Modes', extras.modes],
  ]
  return (
    <dl className="game-extras">
      {lines
        .filter(([, values]) => values.length > 0)
        .map(([label, values]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{values.join(', ')}</dd>
          </div>
        ))}
    </dl>
  )
}

// Prices in the game windows (prices.ts), same look as the To play list (GamePriceLine): Steam
// logo + price + green discount badge (and the old price), key icon + the cheapest key that
// works in France (GG.deals), then the all-time lows. A price opens its Steam or GG.deals page.
// Nothing shows for games not on Steam or when prices can't load.
export function GamePricesInfo({ igdbId }: { igdbId: number }) {
  const prices = useGamePrices(igdbId)
  if (prices === undefined) return <Spinner />
  if (!prices) return null
  const { steam, deals } = prices
  if (isFree(prices)) {
    return (
      <div className="game-prices">
        <div>
          <button className="price-link" onClick={() => openLink(prices.steamUrl)}>
            <SteamIcon /> Free
          </button>
        </div>
      </div>
    )
  }
  const lows = [
    deals?.retailLow && lowText('store', deals.retailLow),
    deals?.keyshopsLow && lowText('key', deals.keyshopsLow),
  ].filter(Boolean)
  const steamWins = steamIsCheapest(prices)
  const keyWins = !!steam && deals?.keyshops != null && !steamWins
  return (
    <div className="game-prices">
      <div>
        <button className={keyWins ? 'price-link price-dearer' : 'price-link'} onClick={() => openLink(prices.steamUrl)}>
          <SteamIcon cheapest={steamWins} /> {steam ? formatEuros(steam.final) : 'No price'}
        </button>
        {steam && steam.discount > 0 && (
          <>
            <span className="price-badge">−{steam.discount}%</span>
            <s className="price-was">{formatEuros(steam.initial)}</s>
          </>
        )}
        {steamAtLowest(prices) && <LowestEver />}
      </div>
      {deals && (
        <div>
          <button className={steamWins ? 'price-link price-dearer' : 'price-link'} onClick={() => openLink(deals.url)}>
            <KeyRound className="price-icon" aria-label="Key" /> {deals.keyshops ? formatEuros(deals.keyshops) : 'None'}
          </button>
          {keyAtLowest(prices) && <LowestEver />}
        </div>
      )}
      {lows.length > 0 && <p className="price-lows">Lowest ever: {lows.join(' · ')}</p>}
    </div>
  )
}

// An all-time low, e.g. "store 16,55 €"; just "Free" rather than "store 0,00 €" (a past giveaway)
const lowText = (where: string, price: string) => (Number(price) === 0 ? 'Free' : `${where} ${formatEuros(price)}`)

// Free to play: Steam gives no price and GG.deals says 0 in stores (key shops may still list odd
// prices for it, e.g. Dota 2: hidden)
function isFree({ steam, deals }: GamePrices) {
  return !steam && deals?.retail != null && Number(deals.retail) === 0
}

// Steam costs no more than the cheapest key (user: equal counts, Steam is the safer buy). Only
// when there is a key price to compare with.
function steamIsCheapest({ steam, deals }: GamePrices) {
  return !!steam && deals?.keyshops != null && steam.final / 100 <= Number(deals.keyshops)
}

// At its lowest price ever (GG.deals history). Steam: GG.deals has no Steam-only history, so
// this compares with the lowest of all official stores (user's choice: never wrong when shown,
// may miss a Steam-only low).
function steamAtLowest({ steam, deals }: GamePrices) {
  return !!steam && deals?.retailLow != null && steam.final <= Math.round(Number(deals.retailLow) * 100)
}

function keyAtLowest({ deals }: GamePrices) {
  return deals?.keyshops != null && deals.keyshopsLow != null && Number(deals.keyshops) <= Number(deals.keyshopsLow)
}

// A small orange flame after a price at its lowest ever
function LowestEver() {
  return (
    <span className="price-flame" title="Lowest price ever">
      <Flame aria-label="Lowest price ever" fill="currentColor" />
    </span>
  )
}

// Steam's logo (Simple Icons, CC0), lucide has no brand icons. Yellow when Steam is the cheapest
// (price line only; the star used to say it there).
function SteamIcon({ cheapest }: { cheapest?: boolean }) {
  return (
    <svg
      className={cheapest ? 'price-icon steam-cheapest' : 'price-icon'}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-label={cheapest ? 'Steam, cheaper than keys' : 'Steam'}
    >
      {cheapest && <title>Cheaper on Steam than keys</title>}
      <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z" />
    </svg>
  )
}

// To play list (user's pick "B"): Steam logo + price + green discount badge, key icon + cheapest
// key. Two lines in the grid, one line in the list (CSS). Only prices already looked up (at
// start, or when the list opens); nothing while unknown.
export function GamePriceLine({ igdbId }: { igdbId: number }) {
  const prices = useKnownPrice(igdbId)
  if (!prices) return null
  const { steam, deals } = prices
  if (isFree(prices)) {
    return (
      <div className="game-price-line">
        <span>
          <SteamIcon /> Free
        </span>
      </div>
    )
  }
  if (!steam && !deals?.keyshops) return null
  // With both prices, the pricier one is gray (user's choice), so the deal shows at a glance
  const steamWins = steamIsCheapest(prices)
  return (
    <div className="game-price-line">
      {steam && (
        <span className={deals?.keyshops && !steamWins ? 'price-dearer' : undefined}>
          <SteamIcon cheapest={steamWins} /> {formatEuros(steam.final)}
          {steam.discount > 0 && <span className="price-badge">−{steam.discount}%</span>}
          {steamAtLowest(prices) && <LowestEver />}
        </span>
      )}
      {deals?.keyshops && (
        <span className={steamWins ? 'price-dearer' : undefined}>
          <KeyRound className="price-icon" aria-label="Key" /> {formatEuros(deals.keyshops)}
          {keyAtLowest(prices) && <LowestEver />}
        </span>
      )}
    </div>
  )
}

// "Watch trailer", the game windows' main (blue) button: opens the trailer view (PC,
// TrailerTheater) or the panel below the window (phone, with an arrow pointing down). Only shown
// when the game has a trailer.
export function TrailerButton(props: { igdbId: number; open: boolean; onToggle: () => void }) {
  const extras = useGameExtras(props.igdbId)
  if (!extras?.trailer) return null
  return (
    <button className={`gd-action trailer-toggle${props.open ? ' open' : ''}`} onClick={props.onToggle}>
      <Play size={15} fill="currentColor" /> <span>Watch trailer</span>
      <ChevronRight size={15} className="trailer-arrow" />
    </button>
  )
}

// PC: the trailer view (opened by TrailerButton, in place of the game window). A header bar
// with the game's info (title; release, platforms, modes; developer, publisher) and the
// buttons, then the player as big as the window allows, keeping its 16:9 shape. Back, Escape
// or a click outside go back to the game window; ✕ closes both. The player loads only now.
export function TrailerTheater(props: {
  igdbId: number
  title: string
  release: string
  platforms: string
  onBack: () => void
  onClose: () => void
}) {
  const extras = useGameExtras(props.igdbId)
  const theaterRef = useRef<HTMLDivElement>(null)
  useEffect(() => theaterRef.current?.focus({ preventScroll: true }), []) // so Escape works
  const trailer = extras?.trailer
  if (!trailer) return null
  const details = [props.release, props.platforms, extras.modes.join(', ')].filter(Boolean)
  const companies = [
    extras.developers.length > 0 && `Developer: ${extras.developers.join(', ')}`,
    extras.publishers.length > 0 && `Publisher: ${extras.publishers.join(', ')}`,
  ].filter(Boolean)
  return (
    <div
      ref={theaterRef}
      className="trailer-theater"
      role="dialog"
      aria-label={`${props.title}: ${trailer.name}`}
      tabIndex={-1}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.key === 'Escape' && props.onBack()}
    >
      <header className="trailer-theater-bar">
        <button className="trailer-theater-back" onClick={props.onBack} title="Back to the game">
          <ChevronLeft size={18} /> Back
        </button>
        <div className="trailer-theater-info">
          <h2>{props.title}</h2>
          <p>{details.join(' · ')}</p>
          {companies.length > 0 && <p>{companies.join(' · ')}</p>}
        </div>
        <button className="game-trailer-link" onClick={() => openLink(`https://www.youtube.com/watch?v=${trailer.id}`)}>
          Open on YouTube
        </button>
        <CloseButton onClick={props.onClose} />
      </header>
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${trailer.id}?autoplay=1&rel=0`}
        title={trailer.name}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  )
}

// Phone: the trailer panel (opened by TrailerButton) below the window, as wide as it.
// Both views: YouTube's player (the privacy-friendly youtube-nocookie address), loaded only when
// opened; YouTube picks the quality from the player's size and the connection (apps can't choose
// it anymore). "Open on YouTube" in case the player can't show (e.g. age-restricted videos).
export function TrailerPanel({ igdbId }: { igdbId: number }) {
  const trailer = useGameExtras(igdbId)?.trailer
  if (!trailer) return null
  return (
    <div className="dialog trailer-panel" onMouseDown={(e) => e.stopPropagation()}>
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${trailer.id}?autoplay=1&rel=0`}
        title={trailer.name}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
      <div className="trailer-panel-foot">
        <span>{trailer.name}</span>
        <button className="game-trailer-link" onClick={() => openLink(`https://www.youtube.com/watch?v=${trailer.id}`)}>
          Open on YouTube
        </button>
      </div>
    </div>
  )
}
