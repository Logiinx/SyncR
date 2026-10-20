import { useState } from 'react'
import { Play } from 'lucide-react'
import { useGameExtras } from './gameExtras'
import { coverUrl } from './igdb'
import { openLink } from './links'
import Spinner from './Spinner'

// The extra details in the game windows (gameExtras.ts): developer, publisher, game modes, and
// the trailer. Nothing shows when they can't load (offline, game search not set up).

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

// The trailer: first the game's cover, darkened, with ▶ and the video's name, so opening a
// game doesn't contact YouTube. A click loads YouTube's player (the privacy-friendly
// youtube-nocookie address) and starts it. "Open on YouTube" in case the player can't show.
export function GameTrailer({ igdbId, coverId }: { igdbId: number; coverId?: string }) {
  const extras = useGameExtras(igdbId)
  const [playing, setPlaying] = useState(false)
  const trailer = extras?.trailer
  if (!trailer) return null
  return (
    <div className="game-trailer">
      {playing ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${trailer.id}?autoplay=1&rel=0`}
          title={trailer.name}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <button
          className="game-trailer-start"
          style={coverId ? { backgroundImage: `url(${coverUrl(coverId, 'cover_big')})` } : undefined}
          onClick={() => setPlaying(true)}
        >
          <span className="game-trailer-play">
            <Play size={22} fill="currentColor" />
          </span>
          <span className="game-trailer-name">{trailer.name}</span>
        </button>
      )}
      <button className="game-trailer-link" onClick={() => openLink(`https://www.youtube.com/watch?v=${trailer.id}`)}>
        Open on YouTube
      </button>
    </div>
  )
}
