import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarCheck, CalendarClock, Download, Gamepad2, LayoutGrid, List, Search, X } from 'lucide-react'
import { canWatch, db, isWatched, pinGameToBoard, setGameStatus, unpinGameFromBoard, updateGame, type Game, type GameStatus } from './db'
import { addGame, formatRelease, gameId, isPlayed, isReleased, priorityLabel, releaseText, removeGameQuestion, shortPlatforms, sortGames, statusLabel, STATUSES } from './games'
import { GamePriceLine } from './GameExtrasView'
import { hasPriceLine, loadListPrices } from './prices'
import { stopWatching } from './priceWatch'
import { WatchBell } from './PriceWatchView'
import { useSteamProfile } from './steam'
import SteamImport from './SteamImport'
import { isComplete, searchGames, useConnection, type FoundGame } from './igdb'
import Cover from './GameCover'
import AddOrInList from './AddOrInList'
import GameCalendar, { CALENDAR_LAYOUTS, DEFAULT_TOP, TOP_LEVELS, type CalendarLayout } from './GameCalendar'
import ContextMenu, { type MenuItem } from './ContextMenu'
import GameDialog, { GameBadge, GameRated, showsRated } from './GameDialog'
import Dialog, { type DialogRequest } from './Dialog'
import { useLocalState } from './localState'
import Spinner from './Spinner'
import { FillSwitch, TabLines, useTabLines } from './tabLines'
import { useListItem, usePage } from './animations'
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
const SHELF_LAYOUTS: { value: ShelfLayout; label: React.ReactNode; title: string }[] = [
  { value: 'grid', label: <LayoutGrid size={15} />, title: 'Covers' },
  { value: 'list', label: <List size={15} />, title: 'List' },
]

function GamesView() {
  const pageRef = useRef<HTMLElement>(null)
  usePage(pageRef)
  const connection = useConnection() // undefined while loading
  const connected = isComplete(connection)
  const games = useLiveQuery(() => db.games.filter((game) => !game.deleted).toArray(), [])
  // Games that have a card on the Board (for "Pin to Board" / "Unpin from Board")
  const pinned = useLiveQuery(
    async () => new Set((await db.cards.toArray()).filter((c) => !c.deleted && c.game).map((c) => c.game!.id)),
    [],
  )
  // The status shown (one at a time) and grid or list, remembered per device
  const [remembered, setShown] = useLocalState<GameStatus>('syncr.gamesStatus', 'waiting')
  // Before v0.20 it could be "done" or "dropped", which became the Library
  const shown: GameStatus = STATUSES.some((s) => s.status === remembered) ? remembered : 'library'
  const [shelf, setShelf] = useLocalState<ShelfLayout>('syncr.gamesLayout', 'grid')
  const statusList = useRef<HTMLDivElement>(null)
  const lines = useTabLines(statusList, shown)
  const [menu, setMenu] = useState<{ game: Game; x: number; y: number } | null>(null)
  const [dialog, setDialog] = useState<DialogRequest | null>(null)
  const [openId, setOpenId] = useState<string | null>(null) // the game whose details are shown
  const [openWatch, setOpenWatch] = useState<string | null>(null) // opened by "Watch price…"
  const steam = useSteamProfile()
  const [importing, setImporting] = useState(false) // the Steam import window
  // To play and Waiting: fresh prices each time the list opens (prices.ts; recent ones aren't asked again)
  useEffect(() => {
    if (canWatch({ status: shown })) loadListPrices()
  }, [shown])
  const [view, setView] = useLocalState<GamesViewName>('syncr.gamesView', 'mine') // remembered per device
  const [layout, setLayout] = useLocalState<CalendarLayout>('syncr.calendarLayout', 'grid') // PC only
  const [top, setTop] = useLocalState('syncr.calendarTop', DEFAULT_TOP)

  function openMenu(game: Game, x: number, y: number) {
    setMenu({ game, x, y })
  }

  async function askRemove(game: Game) {
    setDialog(await removeGameQuestion(game, () => setOpenId(null)))
  }

  // Three groups: Move to … | priority, price alert, Board (priority first, like a Board card's
  // menu) | Remove
  function menuItems(game: Game): MenuItem[] {
    return [
      ...STATUSES.filter((s) => s.status !== game.status).map(({ status, label }) => ({
        label: `Move to ${label}`,
        onClick: () => setGameStatus(game.id, status),
      })),
      {
        label: priorityLabel(game),
        divider: true,
        onClick: () => updateGame(game.id, { priority: !game.priority }),
      },
      // To play and Waiting: the price alert, set in the game window
      ...(!canWatch(game) ? [] : isWatched(game)
        ? [{ label: 'Stop watching', onClick: () => stopWatching(game) }]
        : [{
            label: 'Watch price…',
            onClick: () => {
              setOpenWatch(game.id)
              setOpenId(game.id)
            },
          }]),
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
    <main className="page games-page" ref={pageRef}>
      {/* Wide only for the month grid (not for the "set up the game search" text, which then
          sat further left than in My games) */}
      <div className={view === 'calendar' && layout === 'grid' && connected ? 'games wide' : 'games'}>
        <div className="games-views">
          <FillSwitch className="games-views-switch" options={VIEWS} value={view} onChange={setView} />
          {/* Only with the game search set up: otherwise they do nothing, and the taller header
              put the "set up the game search" text lower than in My games */}
          {view === 'calendar' && connected && (
            <div className="calendar-controls">
              <FillSwitch
                className="calendar-top"
                title="How many of Steam's most wishlisted upcoming games to show"
                before="Top"
                options={TOP_LEVELS.map((level) => ({ value: level, label: level }))}
                value={top}
                onChange={setTop}
              />
              <FillSwitch className="calendar-layouts" options={CALENDAR_LAYOUTS} value={layout} onChange={setLayout} />
            </div>
          )}
        </div>
        {view === 'calendar' ? (
          connected ? (
            <GameCalendar inList={inList} layout={layout} top={top} onOpen={setOpenId} />
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
                <Gamepad2 size={18} />
                <span>
                  Search for a game above to start your list
                  {steam?.steamId ? (
                    <>
                      , or{' '}
                      <button className="games-empty-import" onClick={() => setImporting(true)}>
                        import from Steam…
                      </button>
                    </>
                  ) : '.'}
                </span>
              </p>
            )}
            {importing && <SteamImport onClose={() => setImporting(false)} />}
            {games && games.length > 0 && (
              <>
                {/* Underlined tabs (an empty status shows no count); as wide as the cover grid */}
                <div className={shelf === 'grid' ? 'games-status-tabs wide' : 'games-status-tabs'}>
                  {/* Scrolls sideways when the screen is too narrow (phone) */}
                  <div className="games-status-list" ref={statusList} onPointerLeave={lines.onRowLeave}>
                    {STATUSES.map(({ status, label }) => {
                      const count = games.filter((g) => g.status === status).length
                      let className = shown === status ? 'active' : ''
                      if (lines.hovered === status) className += ' hovered'
                      return (
                        <button key={status} {...lines.tabProps(status)} className={className} onClick={() => setShown(status)}>
                          {label}
                          {count > 0 && <span className="games-count">{count}</span>}
                          <TabLines />
                        </button>
                      )
                    })}
                  </div>
                  {/* Library, with a Steam profile set (Settings → Games) */}
                  {shown === 'library' && steam?.steamId && (
                    <button className="games-import" onClick={() => setImporting(true)}>
                      <Download size={14} /> Import from Steam…
                    </button>
                  )}
                  <FillSwitch className="calendar-layouts games-layouts" options={SHELF_LAYOUTS} value={shelf} onChange={setShelf} />
                </div>
                {/* A new list for each tab and layout: switching isn't games coming and going */}
                <GameShelf
                  key={`${shown}-${shelf}`}
                  games={sortGames(games.filter((g) => g.status === shown))}
                  layout={shelf}
                  emptyText={`No games in ${statusLabel(shown)}`}
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
          focusWatch={openWatch === openId}
          onClose={() => {
            setOpenId(null)
            setOpenWatch(null)
          }}
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
// waiting (or the vague date), "★ 4.5" once rated, else the release year. Badge: GameBadge
function GameTile({ game, onOpen, onMenu }: { game: Game; onOpen: () => void; onMenu: (x: number, y: number) => void }) {
  const when = releaseText(game, 'short')
  const ref = useRef<HTMLDivElement>(null)
  useListItem(ref)
  return (
    <div
      ref={ref}
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
        <GameBadge game={game} />
        {isWatched(game) && <WatchBell game={game} />}
      </div>
      <div className="game-tile-name">{game.name}</div>
      {showsRated(game) ? (
        <GameRated game={game} />
      ) : (
        <div className="game-details">{when}</div>
      )}
      {hasPriceLine(game) && <GamePriceLine igdbId={game.igdbId} />}
    </div>
  )
}

// One game: cover, name, release (full date + countdown while waiting, else the year) and a preview of the
// review (Playing and Library games) or the note. "★ 4.5" on the right (badge on the cover), only for
// Playing and Library games (like in the details; the rating stays saved if the status changes back).
// Platforms only show in the details (and in search results).
function GameRow({ game, onOpen, onMenu }: { game: Game; onOpen: () => void; onMenu: (x: number, y: number) => void }) {
  const played = isPlayed(game)
  const text = (played && game.review.trim()) || game.note.trim()
  const preview = text && (played && game.review.trim() ? `“${text}”` : text)
  const details = [releaseText(game, 'year'), preview].filter(Boolean).join(' · ')
  const ref = useRef<HTMLDivElement>(null)
  useListItem(ref)
  return (
    <div
      ref={ref}
      className={game.priority ? 'game-row priority' : 'game-row'}
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e.clientX, e.clientY)
      }}
    >
      <span className="game-row-cover">
        <Cover coverId={game.coverId} />
        <GameBadge game={game} />
        {isWatched(game) && <WatchBell game={game} />}
      </span>
      <div className="game-text">
        <div className="game-name" title={game.name}>{game.name}</div>
        <div className="game-details" title={details}>{details}</div>
        {hasPriceLine(game) && <GamePriceLine igdbId={game.igdbId} />}
      </div>
      {showsRated(game) && <GameRated game={game} />}
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
          {results.length === 0 && !searching && <p className="game-search-message">No games found</p>}
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
                <AddOrInList
                  status={status}
                  onAdd={() => addGame(found)}
                  onAddTo={isReleased(found) ? (place) => addGame(found, place.status, place.completed) : undefined}
                />
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
