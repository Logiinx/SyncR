import { ChevronRight, Clapperboard } from 'lucide-react'
import { useGameExtras } from './gameExtras'
import { openLink } from './links'
import Spinner from './Spinner'

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

// "Trailer ›": opens the trailer panel beside the window (PC) or below it (phone, the arrow then
// points down). Only shown when the game has a trailer.
export function TrailerButton(props: { igdbId: number; open: boolean; onToggle: () => void }) {
  const extras = useGameExtras(props.igdbId)
  if (!extras?.trailer) return null
  return (
    <button className={`gd-action trailer-toggle${props.open ? ' open' : ''}`} onClick={props.onToggle}>
      <Clapperboard size={15} /> <span>Trailer</span>
      <ChevronRight size={15} className="trailer-arrow" />
    </button>
  )
}

// The trailer panel (opened by TrailerButton): YouTube's player, loaded only now (the
// privacy-friendly youtube-nocookie address) and started. Its size follows the free space on
// the screen (see .trailer-panel), and YouTube picks the quality from the player's size and the
// connection (apps can't choose it anymore). "Open on YouTube" in case the player can't show.
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
