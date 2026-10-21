import { useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight, Play, X } from 'lucide-react'
import { useGameExtras } from './gameExtras'
import { openLink } from './links'
import Spinner from './Spinner'
import { formatEuros, useGamePrices } from './prices'

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

// Prices in the game windows (prices.ts): Steam's price with its discount, the cheapest key
// that works in France (GG.deals), and the all-time lows. A price opens its Steam or GG.deals
// page. Nothing shows for games not on Steam or when prices can't load.
export function GamePricesInfo({ igdbId }: { igdbId: number }) {
  const prices = useGamePrices(igdbId)
  if (prices === undefined) return <Spinner />
  if (!prices) return null
  const { steam, deals } = prices
  const lows = [
    deals?.retailLow && `store ${formatEuros(deals.retailLow)}`,
    deals?.keyshopsLow && `key ${formatEuros(deals.keyshopsLow)}`,
  ].filter(Boolean)
  return (
    <dl className="game-extras game-prices">
      <div>
        <dt>Steam</dt>
        <dd>
          <button className="price-link" onClick={() => openLink(`https://store.steampowered.com/app/${prices.steamId}/`)}>
            {steam ? formatEuros(steam.final) : 'No price'}
          </button>
          {steam && steam.discount > 0 && (
            <span className="price-was">
              −{steam.discount}% <s>{formatEuros(steam.initial)}</s>
            </span>
          )}
        </dd>
      </div>
      {deals && (
        <div>
          <dt>Key</dt>
          <dd>
            <button className="price-link" onClick={() => openLink(deals.url)}>
              {deals.keyshops ? formatEuros(deals.keyshops) : 'None'}
            </button>
          </dd>
        </div>
      )}
      {lows.length > 0 && (
        <div>
          <dt>Lowest ever</dt>
          <dd>{lows.join(' · ')}</dd>
        </div>
      )}
    </dl>
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
        <button className="gd-close" onClick={props.onClose} title="Close">
          <X size={18} />
        </button>
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
