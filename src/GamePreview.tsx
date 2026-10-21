import { useEffect, useRef, useState } from 'react'
import { Pin, X } from 'lucide-react'
import { addGame, isReleased, STATUSES } from './games'
import { coverUrl, type FoundGame } from './igdb'
import type { GameStatus } from './db'
import { GameExtrasInfo, TrailerButton, TrailerPanel, TrailerTheater } from './GameExtrasView'
import { useNarrow } from './useNarrow'

// A game that isn't in your list yet (Calendar, search results): the cover; on the right the
// name, release, all platforms, where it is in your list, the extras (developer, publisher,
// modes), then the add buttons and "Trailer" (PC: the trailer view in place of the window;
// phone: a panel below it). Not out yet: "Add to Waiting"; out: a status bar to pick where it goes.
// ✕, Escape or a click outside closes it.
function GamePreview(props: { game: FoundGame; release: string; status?: GameStatus; onClose: () => void }) {
  const { game, release, status, onClose } = props
  const label = STATUSES.find((s) => s.status === status)?.label
  const [trailerOpen, setTrailerOpen] = useState(false)
  const narrow = useNarrow() // PC: the trailer opens in its own view; phone: below the window
  const popupRef = useRef<HTMLDivElement>(null)
  // So Escape works (again after coming back from the trailer view, or once added: the clicked
  // button is gone)
  useEffect(() => popupRef.current?.focus({ preventScroll: true }), [trailerOpen, status])

  // Only the list's own fields are saved (not the calendar's rank etc.). Its release date follows
  // the usual rule (PC first); a vague date keeps its label ("Q1 2027") and sorts last.
  function add(to: GameStatus) {
    const { igdbId, name, coverId, platforms, releaseDate, releaseLabel } = game
    addGame({ igdbId, name, coverId, platforms, releaseDate, releaseLabel }, to)
  }

  if (trailerOpen && !narrow) {
    return (
      <div className="dialog-backdrop" onMouseDown={() => setTrailerOpen(false)}>
        <TrailerTheater
          igdbId={game.igdbId}
          title={game.name}
          release={release}
          platforms={game.platforms.join(', ')}
          onBack={() => setTrailerOpen(false)}
          onClose={onClose}
        />
      </div>
    )
  }
  const released = isReleased(game)
  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="game-window">
        <div
          ref={popupRef}
          className="dialog calendar-popup"
          role="dialog"
          aria-label={game.name}
          tabIndex={-1}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
        >
          <div className="calendar-popup-head">
            {game.coverId && <img className="calendar-popup-cover" src={coverUrl(game.coverId, 'cover_big')} alt="" />}
            <div className="calendar-popup-main">
              <div className="gd-head">
                <h2>{game.name}</h2>
                <button className="gd-close" onClick={onClose} title="Close">
                  <X size={18} />
                </button>
              </div>
              <p className="calendar-popup-info">{release}</p>
              {game.platforms.length > 0 && <p className="calendar-popup-info">{game.platforms.join(', ')}</p>}
              {label && <p className="calendar-popup-info">In your list: {label}</p>}
              <GameExtrasInfo igdbId={game.igdbId} />
              {!status && released && (
                <>
                  <p className="calendar-popup-info preview-add-label">Add to</p>
                  <div className="gd-status" role="group" aria-label="Add to">
                    {STATUSES.map(({ status, label }) => (
                      <button key={status} onClick={() => add(status)}>
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className="calendar-popup-actions">
                {!status && !released && (
                  <button className="gd-action calendar-popup-pin" onClick={() => add('waiting')}>
                    <Pin size={15} /> <span>Add to Waiting</span>
                  </button>
                )}
                <TrailerButton
                  igdbId={game.igdbId}
                  open={trailerOpen}
                  onToggle={() => setTrailerOpen(!trailerOpen)}
                />
              </div>
            </div>
          </div>
        </div>
        {trailerOpen && <TrailerPanel igdbId={game.igdbId} />}
      </div>
    </div>
  )
}

export default GamePreview
