import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarDays, ChevronDown, CircleCheck, Clock, Gamepad2, Heart, Pin, PinOff, Sparkles, Star, Trash2, Trophy } from 'lucide-react'
import CloseButton from './CloseButton'
import { canWatch, db, pinGameToBoard, pinnedCard, setGameStatus, unpinGameFromBoard, updateGame, type CalendarEvent, type Game, type SteamStats } from './db'
import { allPlatforms, isFavoriteTab, isPlayed, priorityLabel, releaseEventId, releaseText, STATUSES } from './games'
import { openLink } from './links'
import { formatDue } from './reminders'
import { GameExtrasInfo, GamePricesInfo, TrailerButton, TrailerPanel, TrailerTheater } from './GameExtrasView'
import { useNarrow } from './useNarrow'
import { PriceWatchView } from './PriceWatchView'
import { isHundred, playedTime, updateSteamStats } from './steam'
import { coverUrl } from './igdb'
import { FillSwitch } from './tabLines'

// A game's details (click a game in the Games tab, the Board or the Reminders tab). PC: the
// cover with the actions under it on the left; title, status, rating, review and note on the
// right. Phone: stacked (CSS). Rating and review only for finished or dropped games.
// Changes save right away; ✕, Escape or a click outside closes it.

// focusWatch: opened by "Watch price…" (Games tab menu): shows the price alert settings
function GameDialog({ id, focusWatch, onClose, onRemove }: { id: string; focusWatch?: boolean; onClose: () => void; onRemove: () => void }) {
  const game = useLiveQuery(() => db.games.get(id), [id])
  // Its release event in Google Calendar (games.ts), shown under the release date while it exists
  const releaseEvent = useLiveQuery(async () => (game ? db.events.get(releaseEventId(game)) : undefined), [game?.igdbId])
  if (!game) return null
  return <GameDetails game={game} releaseEvent={releaseEvent} focusWatch={focusWatch} onClose={onClose} onRemove={onRemove} />
}

function GameDetails(props: { game: Game; releaseEvent?: CalendarEvent; focusWatch?: boolean; onClose: () => void; onRemove: () => void }) {
  const { game, releaseEvent, focusWatch, onClose, onRemove } = props
  // The texts are kept here while typing (the saved game comes back a moment later)
  const [note, setNote] = useState(game.note)
  const [review, setReview] = useState(game.review)
  const played = isPlayed(game)
  const pinned = useLiveQuery(async () => !!(await pinnedCard(game.id)), [game.id])
  const [trailerOpen, setTrailerOpen] = useState(false) // PC: the trailer view; phone: a panel below
  const narrow = useNarrow()
  // Focused when it opens (so Escape works), without scrolling; again after the trailer view
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => dialogRef.current?.focus({ preventScroll: true }), [trailerOpen])
  // Fresh hours and achievements from Steam when it opens (steam.ts)
  useEffect(() => {
    if (played) updateSteamStats([game])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id, played])

  if (trailerOpen && !narrow) {
    return (
      <div className="dialog-backdrop" onMouseDown={() => setTrailerOpen(false)}>
        <TrailerTheater
          igdbId={game.igdbId}
          title={game.name}
          release={releaseText(game, 'full')}
          platforms={allPlatforms(game.platforms)}
          onBack={() => setTrailerOpen(false)}
          onClose={onClose}
        />
      </div>
    )
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="game-window">
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
              {/* The main action, in blue, first */}
              <TrailerButton
                igdbId={game.igdbId}
                open={trailerOpen}
                onToggle={() => setTrailerOpen(!trailerOpen)}
              />
              <button
                className={game.priority ? 'gd-action on' : 'gd-action'}
                onClick={() => updateGame(game.id, { priority: !game.priority })}
                title={priorityLabel(game)}
                aria-pressed={game.priority}
              >
                {isFavoriteTab(game)
                  ? <><Heart size={15} fill={game.priority ? 'currentColor' : 'none'} /> <span>Favorite</span></>
                  : <><Sparkles size={15} /> <span>Priority</span></>}
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
                  {releaseText(game, 'full')}
                  {game.platforms.length > 0 && ` · ${allPlatforms(game.platforms)}`}
                </p>
                {releaseEvent && releaseEvent.alerts.length > 0 && (
                  <p>Alert: {formatDue(releaseEvent.start - releaseEvent.alerts[0] * 60 * 1000)}</p>
                )}
                <GameExtrasInfo igdbId={game.igdbId} />
                <GamePricesInfo igdbId={game.igdbId} name={game.name} />
              </div>
              <CloseButton onClick={onClose} />
            </div>

            <FillSwitch
              className="gd-status"
              options={STATUSES.map(({ status, label }) => ({ value: status, label }))}
              value={game.status}
              onChange={(status) => status !== game.status && setGameStatus(game.id, status)}
            />

            {canWatch(game) && <PriceWatchView key={game.id} game={game} focus={focusWatch} />}

            {played && (
              <>
                <div className="gd-field">
                  <span>Your rating</span>
                  <div className="game-rating">
                    <Stars value={game.rating} onChange={(rating) => updateGame(game.id, { rating })} />
                    {!!game.rating && <span className="game-rating-number">{game.rating} / 5</span>}
                    <button
                      className={game.completed ? 'game-completed on' : 'game-completed'}
                      onClick={() => updateGame(game.id, { completed: !game.completed })}
                      aria-pressed={!!game.completed}
                    >
                      <CircleCheck size={16} />
                      Completed
                    </button>
                  </div>
                </div>
                {/* From Steam: hours played and achievements (gold at 100%) */}
                {game.steamStats && <SteamStatsView stats={game.steamStats} />}
                <HiddenText
                  label="Review"
                  rows={3}
                  value={review}
                  placeholder="What did you think?"
                  onChange={(text) => {
                    setReview(text)
                    updateGame(game.id, { review: text })
                  }}
                />
              </>
            )}

            <HiddenText
              label="Note"
              rows={2}
              value={note}
              placeholder="Optional"
              onChange={(text) => {
                setNote(text)
                updateGame(game.id, { note: text })
              }}
            />
          </div>
        </div>
        {trailerOpen && <TrailerPanel igdbId={game.igdbId} />}
      </div>
    </div>
  )
}

// Review and note: an empty one is only a small "Note ⌄" button (keeps the window calm); a click
// shows the box and puts the cursor in it. One with text shows open.
function HiddenText({ label, rows, value, placeholder, onChange }: {
  label: string
  rows: number
  value: string
  placeholder: string
  onChange: (text: string) => void
}) {
  const [open, setOpen] = useState(() => value.trim() !== '')
  if (!open) {
    return (
      <button className="gd-reveal" onClick={() => setOpen(true)} aria-expanded={false}>
        {label} <ChevronDown size={14} />
      </button>
    )
  }
  return (
    <label className="gd-field">
      <span>{label}</span>
      <textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        autoFocus={value === ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
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

// Game window: two blocks, hours played and achievements with a bar (gold at 100%)
function SteamStatsView({ stats }: { stats: SteamStats }) {
  const percent = stats.total ? Math.round(((stats.done ?? 0) / stats.total) * 100) : 0
  return (
    <div className="gd-steam">
      <div className="gd-stat">
        <Clock size={18} />
        <div>
          <strong>{playedTime(stats.minutes)}</strong>
          <span>played</span>
        </div>
      </div>
      {!!stats.total && (
        <div className={isHundred(stats) ? 'gd-stat gd-achievements hundred' : 'gd-stat gd-achievements'}>
          <Trophy size={18} />
          <div>
            <div className="gd-stat-top">
              <strong>
                {stats.done ?? 0} / {stats.total}
              </strong>
              <span>achievements</span>
              <span className="gd-percent">{percent}%</span>
            </div>
            <div className="gd-bar" role="progressbar" aria-label="Achievements" aria-valuenow={percent}>
              <div style={{ width: `${percent}%` }} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// A played game's rating in the Games grid and list: "★ 4.5" (only when rated: showsRated)
export const showsRated = (game: Game) => isPlayed(game) && !!game.rating
export function GameRated({ game }: { game: Game }) {
  return (
    <span className="game-rated" aria-label={`${game.rating} stars`}>
      <Star size={12} /> {game.rating}
    </span>
  )
}

// A played game's badge in the cover's corner (grid and list): gold trophy at 100% Steam
// achievements, else a green check when Completed. Favorites need none: the frame shows them.
export function GameBadge({ game }: { game: Game }) {
  if (!isPlayed(game)) return null
  if (isHundred(game.steamStats)) return <span className="game-badge hundred" title="100% achievements"><Trophy /></span>
  if (game.completed) return <span className="game-badge done" title="Completed"><CircleCheck /></span>
  return null
}

export default GameDialog
