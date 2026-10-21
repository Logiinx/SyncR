import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarCheck, CalendarClock, CalendarDays, Gamepad2, Heart, LayoutGrid, List, Search, Sparkles, X } from 'lucide-react'
import { db, pinGameToBoard, setGameStatus, unpinGameFromBoard, updateGame, type Game, type GameStatus } from './db'
import { addGame, formatRelease, gameId, releaseText, shortPlatforms, sortGames, statusLabel, STATUSES } from './games'
import { GamePriceLine } from './GameExtrasView'
import { loadToPlayPrices } from './prices'
import { isComplete, searchGames, useConnection, type FoundGame } from './igdb'
import Cover from './GameCover'
import AddOrInList from './AddOrInList'
import GameCalendar, { DEFAULT_TOP, TOP_LEVELS, type CalendarLayout } from './GameCalendar'
import ContextMenu, { type MenuItem } from './ContextMenu'
import GameDialog, { RatingStars } from './GameDialog'
import Dialog, { type DialogRequest } from './Dialog'
import { useLocalState } from './localState'
import Spinner from './Spinner'
import GamePreview from './GamePreview'

// The Games tab: your games in groups by status, and a search (IGDB) to add more.
// Click a game for its details (GameDialog.tsx); right-click / long press for a quick menu.

const SEARCH_DELAY = 400 // ms after the last key before searching

type GamesViewName = 'mine' | 'calendar'
type ShelfLayout = 'grid' | 'list'
const VIEWS: { value: GamesViewName; label: string }[] = [
  { value: 'mine', label: 'My games' },
  { value: 'calendar', label: 'Calendar' },
]

function GamesView() {
  const connection = useConnection() // undefined while loading
  const connected = isComplete(connection)
  const games = useLiveQuery(() => db.games.filter((game) => !game.deleted).toArray(), [])
  // Games that have a card on the Board (for "Pin to Board" / "Unpin from Board")
  const pinned = useLiveQuery(
    async () => new Set((await db.cards.toArray()).filter((c) => !c.deleted && c.game).map((c) => c.game!.id)),
    [],
  )
  // The status shown (one at a time) and grid or list, remembered per device
  const [shown, setShown] = useLocalState<GameStatus>('syncr.gamesStatus', 'waiting')
  const [shelf, setShelf] = useLocalState<ShelfLayout>('syncr.gamesLayout', 'grid')
  const [menu, setMenu] = useState<{ game: Game; x: number; y: number } | null>(null)
  const [dialog, setDialog] = useState<DialogRequest | null>(null)
  const [openId, setOpenId] = useState<string | null>(null) // the game whose details are shown
  // To play: fresh prices each time the list opens (prices.ts; recent ones aren't asked again)
  useEffect(() => {
    if (shown === 'toplay') loadToPlayPrices()
  }, [shown])
  const [view, setView] = useLocalState<GamesViewName>('syncr.gamesView', 'mine') // remembered per device
  const [layout, setLayout] = useLocalState<CalendarLayout>('syncr.calendarLayout', 'grid') // PC only
  const [top, setTop] = useLocalState('syncr.calendarTop', DEFAULT_TOP)

  function openMenu(game: Game, x: number, y: number) {
    setMenu({ game, x, y })
  }

  function askRemove(game: Game) {
    setDialog({
      title: 'Remove game?',
      message: `"${game.name}" will be removed from your list, with its note and review.`,
      confirmLabel: 'Remove',
      danger: true,
      onConfirm: () => {
        setOpenId(null)
        updateGame(game.id, { deleted: true })
      },
    })
  }

  function menuItems(game: Game): MenuItem[] {
    return [
      ...STATUSES.filter((s) => s.status !== game.status).map(({ status, label }) => ({
        label: `Move to ${label}`,
        onClick: () => setGameStatus(game.id, status),
      })),
      {
        label: game.priority ? 'Remove priority' : 'Mark as priority',
        onClick: () => updateGame(game.id, { priority: !game.priority }),
      },
      pinned?.has(game.id)
        ? { label: 'Unpin from Board', onClick: () => unpinGameFromBoard(game.id) }
        : {
            label: 'Pin to Board',
            onClick: async () => {
              await pinGameToBoard(game)
              window.dispatchEvent(new Event('open-board')) // show it (App.tsx)
            },
          },
      { label: 'Remove from list', danger: true, onClick: () => askRemove(game) },
    ]
  }

  const inList = new Map(games?.map((g) => [g.id, g.status]))
  return (
    <main className="page games-page">
      {/* Wide only for the month grid (not for the "set up the game search" text, which then
          sat further left than in My games) */}
      <div className={view === 'calendar' && layout === 'grid' && connected ? 'games wide' : 'games'}>
        <div className="games-views">
          <div className="games-views-switch">
            {VIEWS.map(({ value, label }) => (
              <button key={value} className={view === value ? 'active' : ''} onClick={() => setView(value)}>
                {label}
              </button>
            ))}
          </div>
          {/* Only with the game search set up: otherwise they do nothing, and the taller header
              put the "set up the game search" text lower than in My games */}
          {view === 'calendar' && connected && (
            <div className="calendar-controls">
              <div className="calendar-top" title="How many of Steam's most wishlisted upcoming games to show">
                Top
                {TOP_LEVELS.map((level) => (
                  <button key={level} className={top === level ? 'active' : ''} onClick={() => setTop(level)}>
                    {level}
                  </button>
                ))}
              </div>
              <div className="calendar-layouts">
                <button className={layout === 'grid' ? 'active' : ''} onClick={() => setLayout('grid')} title="Month grid">
                  <CalendarDays size={15} />
                </button>
                <button className={layout === 'list' ? 'active' : ''} onClick={() => setLayout('list')} title="List">
                  <List size={15} />
                </button>
              </div>
            </div>
          )}
        </div>
        {view === 'calendar' ? (
          connected ? (
            <GameCalendar inList={inList} layout={layout} top={top} />
          ) : (
            connection && (
              <p className="games-empty">To see upcoming games, set up the game search in Settings → Games.</p>
            )
          )
        ) : (
          <>
            {games && <DelayBanner games={games} />}
            <GameSearch inList={inList} onOpen={setOpenId} />
            {games && games.length === 0 && connected && (
              <p className="games-empty">
                <Gamepad2 size={18} /> Search for a game above to start your list.
              </p>
            )}
            {games && games.length > 0 && (
              <>
                {/* Underlined tabs (an empty status shows no count); as wide as the cover grid */}
                <div className={shelf === 'grid' ? 'games-status-tabs wide' : 'games-status-tabs'}>
                  {/* Scrolls sideways when the screen is too narrow (phone) */}
                  <div className="games-status-list">
                    {STATUSES.map(({ status, label }) => {
                      const count = games.filter((g) => g.status === status).length
                      return (
                        <button key={status} className={shown === status ? 'active' : ''} onClick={() => setShown(status)}>
                          {label}
                          {count > 0 && <span className="games-count">{count}</span>}
                        </button>
                      )
                    })}
                  </div>
                  <div className="calendar-layouts games-layouts">
                    <button className={shelf === 'grid' ? 'active' : ''} onClick={() => setShelf('grid')} title="Covers">
                      <LayoutGrid size={15} />
                    </button>
                    <button className={shelf === 'list' ? 'active' : ''} onClick={() => setShelf('list')} title="List">
                      <List size={15} />
                    </button>
                  </div>
                </div>
                <GameShelf
                  games={sortGames(games.filter((g) => g.status === shown))}
                  layout={shelf}
                  emptyText={`No games in ${statusLabel(shown)}.`}
                  onOpen={setOpenId}
                  onMenu={openMenu}
                />
              </>
            )}
          </>
        )}
      </div>
      {openId && (
        <GameDialog
          id={openId}
          onClose={() => setOpenId(null)}
          onRemove={() => {
            const game = games?.find((g) => g.id === openId)
            if (game) askRemove(game)
          }}
        />
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.game)} onClose={() => setMenu(null)} />}
      {dialog && <Dialog request={dialog} onClose={() => setDialog(null)} />}
    </main>
  )
}

// The games of one status: big covers in a grid, or rows
function GameShelf({
  games,
  layout,
  emptyText,
  onOpen,
  onMenu,
}: {
  games: Game[]
  layout: ShelfLayout
  emptyText: string
  onOpen: (id: string) => void
  onMenu: (game: Game, x: number, y: number) => void
}) {
  if (games.length === 0) return <p className="games-shelf-empty">{emptyText}</p>
  const Item = layout === 'grid' ? GameTile : GameRow
  return (
    <div className={layout === 'grid' ? 'games-grid' : 'games-group'}>
      {games.map((game) => (
        <Item key={game.id} game={game} onOpen={() => onOpen(game.id)} onMenu={(x, y) => onMenu(game, x, y)} />
      ))}
    </div>
  )
}

// One game in the grid: big cover, name (2 lines max), and one short line: the countdown while
// waiting (or the vague date), stars and heart once played, else the release year
function GameTile({ game, onOpen, onMenu }: { game: Game; onOpen: () => void; onMenu: (x: number, y: number) => void }) {
  const played = game.status === 'done' || game.status === 'dropped'
  const when = releaseText(game, 'short')
  return (
    <div
      className={game.priority ? 'game-tile priority' : 'game-tile'}
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e.clientX, e.clientY)
      }}
      title={game.status === 'waiting' ? `${game.name}\n${formatRelease(game.releaseDate, game.releaseLabel)}` : game.name}
    >
      <div className="game-tile-cover">
        <Cover coverId={game.coverId} big />
        {game.priority && <Sparkles size={14} className="game-priority-icon" aria-label="Priority" />}
      </div>
      <div className="game-tile-name">{game.name}</div>
      {played && (game.rating || game.liked) ? (
        <span className="game-rated">
          <RatingStars rating={game.rating} />
          {game.liked && <Heart size={12} className="game-liked" aria-label="Liked" />}
        </span>
      ) : (
        <div className="game-details">{when}</div>
      )}
      {game.status === 'toplay' && <GamePriceLine igdbId={game.igdbId} />}
    </div>
  )
}

// One game: cover, name, release (full date + countdown while waiting, else the year) and a preview of the
// review (finished or dropped games) or the note. Stars and heart on the right, only for finished or
// dropped games (like in the details; the rating stays saved if the status changes back).
// Platforms only show in the details (and in search results).
function GameRow({ game, onOpen, onMenu }: { game: Game; onOpen: () => void; onMenu: (x: number, y: number) => void }) {
  const played = game.status === 'done' || game.status === 'dropped'
  const text = (played && game.review.trim()) || game.note.trim()
  const preview = text && (played && game.review.trim() ? `“${text}”` : text)
  const details = [releaseText(game, 'year'), preview].filter(Boolean).join(' · ')
  return (
    <div
      className={game.priority ? 'game-row priority' : 'game-row'}
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e.clientX, e.clientY)
      }}
    >
      <Cover coverId={game.coverId} />
      <div className="game-text">
        <div className="game-name" title={game.name}>{game.name}</div>
        <div className="game-details" title={details}>{details}</div>
        {game.status === 'toplay' && <GamePriceLine igdbId={game.igdbId} />}
      </div>
      {played && (game.rating || game.liked) && (
        <span className="game-rated">
          <RatingStars rating={game.rating} />
          {game.liked && <Heart size={12} className="game-liked" aria-label="Liked" />}
        </span>
      )}
      {game.priority && <Sparkles size={14} className="game-priority-icon" aria-label="Priority" />}
    </div>
  )
}

// What the daily refresh found (games.ts), until dismissed (✕): Waiting games whose date got
// more precise ("Date set", green) and delayed games (yellow). Old date → new date. Saved on
// the game, so it shows on both devices.
function DelayBanner({ games }: { games: Game[] }) {
  const dated = games.filter((g) => g.datedFrom)
  const delayed = games.filter((g) => g.delayedFrom || g.delayedFromLabel)
  if (dated.length === 0 && delayed.length === 0) return null
  return (
    <div className="games-delays">
      {dated.map((game) => (
        <div key={`dated-${game.id}`} className="games-delay games-dated">
          <CalendarCheck size={15} />
          <span>
            <b>Date set:</b> {game.name} · {game.datedFrom} → {formatRelease(game.releaseDate, game.releaseLabel)}
          </span>
          <button onClick={() => updateGame(game.id, { datedFrom: undefined })} title="Dismiss">
            <X size={15} />
          </button>
        </div>
      ))}
      {delayed.map((game) => (
        <div key={game.id} className="games-delay">
          <CalendarClock size={15} />
          <span>
            <b>Delayed:</b> {game.name} · {formatRelease(game.delayedFrom, game.delayedFromLabel)} →{' '}
            {formatRelease(game.releaseDate, game.releaseLabel)}
          </span>
          <button onClick={() => updateGame(game.id, { delayedFrom: undefined, delayedFromLabel: undefined })} title="Dismiss">
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  )
}

// The search box at the top. Results show below it; "Add" puts a game in the list. Click a result
// for a preview (GamePreview.tsx), or for its details if it's already in your list.
function GameSearch({ inList, onOpen }: { inList: Map<string, GameStatus>; onOpen: (id: string) => void }) {
  const connection = useConnection() // undefined while loading
  const connected = isComplete(connection)
  const [text, setText] = useState('')
  const [includeDlc, setIncludeDlc] = useLocalState('syncr.gamesIncludeDlc', false)
  const [results, setResults] = useState<FoundGame[] | null>(null)
  const [preview, setPreview] = useState<FoundGame | null>(null)
  const [error, setError] = useState('')
  const [searching, setSearching] = useState(false)
  const latest = useRef(0) // only the newest search may show its results

  useEffect(() => {
    if (!text.trim()) {
      setResults(null)
      setError('')
      return
    }
    const run = ++latest.current
    const timer = window.setTimeout(async () => {
      setSearching(true)
      try {
        const found = await searchGames(text, includeDlc)
        if (run === latest.current) {
          setResults(found)
          setError('')
        }
      } catch (e) {
        if (run === latest.current) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (run === latest.current) setSearching(false)
      }
    }, SEARCH_DELAY)
    return () => window.clearTimeout(timer)
  }, [text, includeDlc])

  if (connection === undefined) return null
  if (!connected) {
    return <p className="games-empty">To search for games, set up the game search in Settings → Games.</p>
  }

  return (
    <div className="game-search">
      <div className="game-search-bar">
        <Search size={15} />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setText('')}
          placeholder="Search for a game to add"
          spellCheck={false}
        />
        {searching && <Spinner label="Searching" />}
        {text && (
          <button className="game-search-clear" onClick={() => setText('')} title="Clear">
            <X size={15} />
          </button>
        )}
      </div>
      <label className="game-search-dlc">
        <input type="checkbox" checked={includeDlc} onChange={(e) => setIncludeDlc(e.target.checked)} />
        Include DLCs, editions and bundles
      </label>
      {error && <p className="game-search-message error">{error}</p>}
      {results && !error && (
        <div className="game-results">
          {results.length === 0 && !searching && <p className="game-search-message">No games found.</p>}
          {results.map((found) => {
            const id = gameId(found.igdbId)
            const status = inList.get(id)
            return (
              <div
                key={found.igdbId}
                className="game-row game-result"
                onClick={() => (status ? onOpen(id) : setPreview(found))}
              >
                <Cover coverId={found.coverId} />
                <div className="game-text">
                  <div className="game-name" title={found.name}>{found.name}</div>
                  <div className="game-details">
                    {[releaseText(found, 'full'), shortPlatforms(found.platforms)].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <AddOrInList status={status} onAdd={() => addGame(found)} />
              </div>
            )
          })}
        </div>
      )}
      {preview && (
        <GamePreview
          game={preview}
          release={releaseText(preview, 'full')}
          status={inList.get(gameId(preview.igdbId))}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  )
}

export default GamesView
