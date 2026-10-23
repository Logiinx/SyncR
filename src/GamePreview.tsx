import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Pin, Plus } from 'lucide-react'
import CloseButton from './CloseButton'
import { ADD_PLACES, addGame, allPlatforms, isReleased, statusLabel } from './games'
import { coverUrl, type FoundGame } from './igdb'
import type { GameStatus } from './db'
import { GameExtrasInfo, GamePricesInfo, TrailerButton, TrailerPanel, TrailerTheater } from './GameExtrasView'
import { useNarrow } from './useNarrow'
import ContextMenu from './ContextMenu'

// A game that isn't in your list yet (Calendar, search results): the cover; on the right the
// name, release, all platforms, where it is in your list, the extras (developer, publisher,
// modes), then the add button and "Trailer" (PC: the trailer view in place of the window;
// phone: a panel below it). Not out yet: "Add to Waiting"; out: "Add to list", a menu of statuses.
// ✕, Escape or a click outside closes it.
function GamePreview(props: { game: FoundGame; release: string; status?: GameStatus; onClose: () => void }) {
  const { game, release, status, onClose } = props
  const label = statusLabel(status)
  const [trailerOpen, setTrailerOpen] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null) // "Add to list"
  const narrow = useNarrow() // PC: the trailer opens in its own view; phone: below the window
  const popupRef = useRef<HTMLDivElement>(null)
  // So Escape works (again after coming back from the trailer view, or once added: the clicked
  // button is gone)
  useEffect(() => popupRef.current?.focus({ preventScroll: true }), [trailerOpen, status])

  // Only the list's own fields are saved (not the calendar's rank etc.). Its release date follows
  // the usual rule (PC first); a vague date keeps its label ("Q1 2027") and sorts last.
  function add(to: GameStatus, completed?: boolean) {
    const { igdbId, name, coverId, platforms, releaseDate, releaseLabel } = game
    addGame({ igdbId, name, coverId, platforms, releaseDate, releaseLabel }, to, completed)
  }

  if (trailerOpen && !narrow) {
    return (
      <div className="dialog-backdrop" onMouseDown={() => setTrailerOpen(false)}>
        <TrailerTheater
          igdbId={game.igdbId}
          title={game.name}
          release={release}
          platforms={allPlatforms(game.platforms)}
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
          onKeyDown={(e) => e.key === 'Escape' && !menu && onClose()} // Escape first closes the menu
        >
          <div className="calendar-popup-head">
            {game.coverId && <img className="calendar-popup-cover" src={coverUrl(game.coverId, 'cover_big')} alt="" />}
            <div className="calendar-popup-main">
              <div className="gd-head">
                <h2>{game.name}</h2>
                <CloseButton onClick={onClose} />
              </div>
              <p className="calendar-popup-info">{release}</p>
              {game.platforms.length > 0 && <p className="calendar-popup-info">{allPlatforms(game.platforms)}</p>}
              {label && <p className="calendar-popup-info">In {label}</p>}
              <GameExtrasInfo igdbId={game.igdbId} />
              <GamePricesInfo igdbId={game.igdbId} />
              <div className="calendar-popup-actions">
                {!status && !released && (
                  <button className="gd-action calendar-popup-pin" onClick={() => add('waiting')}>
                    <Pin size={15} /> <span>Add to Waiting</span>
                  </button>
                )}
                {!status && released && (
                  <button
                    className="gd-action calendar-popup-pin"
                    onClick={(e) => {
                      const box = e.currentTarget.getBoundingClientRect()
                      setMenu({ x: box.left, y: box.bottom + 4 })
                    }}
                  >
                    <Plus size={15} /> <span>Add to list</span> <ChevronDown size={14} />
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
          {menu && (
            <ContextMenu
              x={menu.x}
              y={menu.y}
              items={ADD_PLACES.map((place) => ({ label: place.label, onClick: () => add(place.status, place.completed) }))}
              onClose={() => setMenu(null)}
            />
          )}
        </div>
        {trailerOpen && <TrailerPanel igdbId={game.igdbId} />}
      </div>
    </div>
  )
}

export default GamePreview
