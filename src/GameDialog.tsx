import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarDays, Gamepad2, Heart, Pin, PinOff, Sparkles, Star, Trash2, X } from 'lucide-react'
import { db, pinGameToBoard, pinnedCard, setGameStatus, unpinGameFromBoard, updateGame, type CalendarEvent, type Game } from './db'
import { formatRelease, releaseEventId, shortPlatforms, STATUSES } from './games'
import { openLink } from './links'
import { GameExtrasInfo, GameTrailer } from './GameExtrasView'
import { coverUrl } from './igdb'

// A game's details (click a game in the Games tab, the Board or the Reminders tab). PC: the
// cover with the actions under it on the left; title, status, rating, review and note on the
// right. Phone: stacked (CSS). Rating and review only for finished or dropped games.
// Changes save right away; ✕, Escape or a click outside closes it.

function GameDialog({ id, onClose, onRemove }: { id: string; onClose: () => void; onRemove: () => void }) {
  const game = useLiveQuery(() => db.games.get(id), [id])
  // Its release event in Google Calendar (games.ts), shown under the release date while it exists
  const releaseEvent = useLiveQuery(async () => (game ? db.events.get(releaseEventId(game)) : undefined), [game?.igdbId])
  if (!game) return null
  return <GameDetails game={game} releaseEvent={releaseEvent} onClose={onClose} onRemove={onRemove} />
}

function GameDetails(props: { game: Game; releaseEvent?: CalendarEvent; onClose: () => void; onRemove: () => void }) {
  const { game, releaseEvent, onClose, onRemove } = props
  // The texts are kept here while typing (the saved game comes back a moment later)
  const [note, setNote] = useState(game.note)
  const [review, setReview] = useState(game.review)
  const played = game.status === 'done' || game.status === 'dropped'
  const pinned = useLiveQuery(async () => !!(await pinnedCard(game.id)), [game.id])
  // Focused when it opens (so Escape works), without scrolling
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => dialogRef.current?.focus({ preventScroll: true }), [])

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        className="dialog game-dialog"
        role="dialog"
        aria-label={game.name}
        ref={dialogRef}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        {/* Left (PC): the cover and the actions. Phone: the cover beside the title, actions as icons */}
        <div className="gd-side">
          {game.coverId ? (
            <img className="gd-cover" src={coverUrl(game.coverId, 'cover_big')} alt="" />
          ) : (
            <span className="gd-cover gd-cover-none">
              <Gamepad2 size={28} />
            </span>
          )}
          <div className="gd-actions">
            <button
              className={game.priority ? 'gd-action on' : 'gd-action'}
              onClick={() => updateGame(game.id, { priority: !game.priority })}
              title={game.priority ? 'Remove priority' : 'Mark as priority'}
              aria-pressed={game.priority}
            >
              <Sparkles size={15} /> <span>Priority</span>
            </button>
            <button
              className="gd-action"
              onClick={async () => {
                if (pinned) return unpinGameFromBoard(game.id)
                await pinGameToBoard(game)
                window.dispatchEvent(new Event('open-board')) // show it (App.tsx)
              }}
              title={pinned ? 'Unpin from Board' : 'Pin to Board'}
            >
              {pinned ? <PinOff size={15} /> : <Pin size={15} />} <span>{pinned ? 'Unpin from Board' : 'Pin to Board'}</span>
            </button>
            {/* Its release event (made by SyncR for Waiting games, games.ts) */}
            {releaseEvent && (
              <button className="gd-action" title="Open in Google Calendar" onClick={() => openLink(releaseEvent.link)}>
                <CalendarDays size={15} /> <span>Google Calendar</span>
              </button>
            )}
            <button className="gd-action gd-remove" onClick={onRemove} title="Remove from list">
              <Trash2 size={15} /> <span>Remove from list</span>
            </button>
          </div>
        </div>

        <div className="gd-main">
          <div className="gd-head">
            <div className="gd-title">
              <h2>{game.name}</h2>
              <p>
                {formatRelease(game.releaseDate, game.releaseLabel)}
                {game.platforms.length > 0 && ` · ${shortPlatforms(game.platforms)}`}
              </p>
              {releaseEvent && releaseEvent.alerts.length > 0 && (
                <p>Alert: {reminderTime(releaseEvent.start - releaseEvent.alerts[0] * 60 * 1000)}</p>
              )}
              <GameExtrasInfo igdbId={game.igdbId} />
            </div>
            <button className="gd-close" onClick={onClose} title="Close">
              <X size={18} />
            </button>
          </div>

          <div className="gd-status" role="group" aria-label="Status">
            {STATUSES.map(({ status, label }) => (
              <button
                key={status}
                className={status === game.status ? 'active' : ''}
                onClick={() => status !== game.status && setGameStatus(game.id, status)}
              >
                {label}
              </button>
            ))}
          </div>

          {played && (
            <>
              <div className="game-rating">
                <Stars value={game.rating} onChange={(rating) => updateGame(game.id, { rating })} />
                <button
                  className={game.liked ? 'game-heart on' : 'game-heart'}
                  onClick={() => updateGame(game.id, { liked: !game.liked })}
                  title={game.liked ? 'Liked' : 'Like'}
                  aria-pressed={game.liked}
                >
                  <Heart size={20} />
                </button>
              </div>
              <label className="gd-field">
                <span>Review</span>
                <textarea
                  rows={3}
                  value={review}
                  placeholder="What did you think?"
                  onChange={(e) => {
                    setReview(e.target.value)
                    updateGame(game.id, { review: e.target.value })
                  }}
                />
              </label>
            </>
          )}

          <label className="gd-field">
            <span>Note</span>
            <textarea
              rows={2}
              value={note}
              placeholder="Optional"
              onChange={(e) => {
                setNote(e.target.value)
                updateGame(game.id, { note: e.target.value })
              }}
            />
          </label>

          <GameTrailer igdbId={game.igdbId} coverId={game.coverId} />
        </div>
      </div>
    </div>
  )
}

// 5 stars in halves: the left half of a star gives a half star. Clicking the current value
// clears the rating. Hovering shows what a click would give.
function Stars({ value, onChange }: { value?: number; onChange: (value: number | undefined) => void }) {
  const [hover, setHover] = useState<number | null>(null)
  const shown = hover ?? value ?? 0
  return (
    <div className="stars" onMouseLeave={() => setHover(null)} role="group" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((star) => {
        const fill = shown >= star ? 100 : shown >= star - 0.5 ? 50 : 0
        return (
          <span key={star} className="star">
            <Star size={28} className="star-back" />
            <span className="star-front" style={{ width: `${fill}%` }}>
              <Star size={28} />
            </span>
            {[star - 0.5, star].map((half) => (
              <button
                key={half}
                className={half % 1 ? 'star-half left' : 'star-half right'}
                aria-label={`${half} stars`}
                onMouseEnter={() => setHover(half)}
                onClick={() => onChange(half === value ? undefined : half)}
              />
            ))}
          </span>
        )
      })}
    </div>
  )
}

// "Tue 27 Oct, 10:00"
const reminderTime = (time: number) =>
  new Date(time).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

// The rating in the list's rows: only the stars given, the last one cut in half for a half star
export function RatingStars({ rating }: { rating?: number }) {
  if (!rating) return null
  const stars = Math.ceil(rating)
  return (
    <span className="rating-stars" aria-label={`${rating} stars`}>
      {Array.from({ length: stars }, (_, i) => (
        <span key={i} className={i + 1 > rating ? 'rating-star half' : 'rating-star'}>
          <Star size={12} />
        </span>
      ))}
    </span>
  )
}

export default GameDialog
