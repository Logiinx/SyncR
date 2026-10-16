import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarPlus, Flag, Heart } from 'lucide-react'
import { db, setGameStatus, updateGame, type Game } from './db'
import { formatRelease, isReleased, releaseReminderText, releaseReminderTime, STATUSES } from './games'
import { addToGoogleCalendar } from './reminders'
import { coverUrl } from './igdb'

// A game's details (click a game in the Games tab): status, flag, note, and for games you've
// finished or dropped: stars, heart and review. Changes save right away; Close closes.

function GameDialog({ id, onClose, onRemove }: { id: string; onClose: () => void; onRemove: () => void }) {
  const game = useLiveQuery(() => db.games.get(id), [id])
  if (!game) return null
  return <GameDetails game={game} onClose={onClose} onRemove={onRemove} />
}

function GameDetails({ game, onClose, onRemove }: { game: Game; onClose: () => void; onRemove: () => void }) {
  // The texts are kept here while typing (the saved game comes back a moment later)
  const [note, setNote] = useState(game.note)
  const [review, setReview] = useState(game.review)
  const played = game.status === 'done' || game.status === 'dropped'

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        className="dialog game-dialog"
        role="dialog"
        aria-label={game.name}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <div className="game-dialog-head">
          {game.coverId && <img className="game-dialog-cover" src={coverUrl(game.coverId, 'cover_big')} alt="" />}
          <div>
            <h2>{game.name}</h2>
            <p className="game-dialog-info">
              {formatRelease(game.releaseDate, game.releaseLabel)}
              {game.platforms.length > 0 && ` · ${game.platforms.join(', ')}`}
            </p>
            <div className="game-dialog-actions">
              <button
                className={game.priority ? 'game-dialog-flag on' : 'game-dialog-flag'}
                onClick={() => updateGame(game.id, { priority: !game.priority })}
              >
                <Flag size={14} /> {game.priority ? 'Flagged' : 'Flag'}
              </button>
              {/* The release reminder's time and text, as a Google Calendar event (for the phone) */}
              {game.status === 'waiting' && game.releaseDate && !isReleased(game) && (
                <button
                  className="game-dialog-flag"
                  title="Add the release reminder to Google Calendar (2 days before, 10:00)"
                  onClick={() =>
                    addToGoogleCalendar({
                      text: releaseReminderText(game),
                      note: '',
                      dueAt: releaseReminderTime(game.releaseDate!),
                    })
                  }
                >
                  <CalendarPlus size={14} /> Google Calendar
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="game-status-choices">
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

        <label className="setting">
          <span className="setting-label">Note</span>
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
            <label className="setting">
              <span className="setting-label">Review</span>
              <textarea
                rows={3}
                value={review}
                placeholder="Optional"
                onChange={(e) => {
                  setReview(e.target.value)
                  updateGame(game.id, { review: e.target.value })
                }}
              />
            </label>
          </>
        )}

        <div className="dialog-buttons game-dialog-buttons">
          <button className="game-remove" onClick={onRemove}>
            Remove from list
          </button>
          <button className="primary" onClick={onClose} autoFocus>
            Close
          </button>
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
            <span className="star-back">★</span>
            <span className="star-front" style={{ width: `${fill}%` }}>
              ★
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

// "★★★½" for the rows in the list
export function starText(rating?: number) {
  if (!rating) return ''
  return '★'.repeat(Math.floor(rating)) + (rating % 1 ? '½' : '')
}

export default GameDialog
