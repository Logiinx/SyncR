import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowRight, CalendarCheck, CalendarClock, Download, Gamepad2, LayoutGrid, List, Search, X } from 'lucide-react'
import { canWatch, db, isWatched, updateGame, type Game, type GameStatus } from './db'
import { addGame, formatRelease, gameId, isPlayed, isReleased, releaseText, removeGameQuestion, shortPlatforms, sortGames, statusLabel, tabOf, TABS, type GamesTab } from './games'
import { ENDING_HEADER, endingMenuItems, gameMenuAt, gameMenuItems, type GameMenu } from './gameMenu'
import { GamePriceLine } from './GameExtrasView'
import { hasPriceLine, loadListPrices, usePricesVersion } from './prices'
import { PreorderBadge, WatchBell } from './PriceWatchView'
import { isHundred, playedText, useSteamProfile } from './steam'
import { shortDate } from './dates'
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

// The open tab: To buy at each start (the user checks it most), then the last one opened
let sessionTab: GamesTab = 'tobuy'
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
  usePricesVersion() // To buy: games on sale first, once their prices are known (sortGames)
  // The tab shown (one at a time); grid or list, remembered per device
  const [shown, setShownState] = useState<GamesTab>(sessionTab)
  const setShown = (tab: GamesTab) => setShownState((sessionTab = tab))
  const [shelf, setShelf] = useLocalState<ShelfLayout>('syncr.gamesLayout', 'grid')
  const statusList = useRef<HTMLDivElement>(null)
  const lines = useTabLines(statusList, shown)
  const [menu, setMenu] = useState<GameMenu | null>(null)
  const [endingMenu, setEndingMenu] = useState<GameMenu | null>(null) // "How did it end?" (Playing → Library)
  const [dialog, setDialog] = useState<DialogRequest | null>(null)
  const [openId, setOpenId] = useState<string | null>(null) // the game whose details are shown
  const [openWatch, setOpenWatch] = useState<string | null>(null) // opened by "Watch price…"
  const steam = useSteamProfile()
  const [importing, setImporting] = useState(false) // the Steam import window
  // To buy and Upcoming: fresh prices each time the list opens (prices.ts; recent ones aren't asked again)
  useEffect(() => {
    if (TABS.find((t) => t.tab === shown)!.statuses.some((status) => canWatch({ status }))) loadListPrices()
  }, [shown])
  const [view, setView] = useLocalState<GamesViewName>('syncr.gamesView', 'mine') // remembered per device
  const [layout, setLayout] = useLocalState<CalendarLayout>('syncr.calendarLayout', 'grid') // PC only
  const [top, setTop] = useLocalState('syncr.calendarTop', DEFAULT_TOP)

  function openMenu(game: Game, x: number, y: number) {
    gameMenuAt(game, x, y).then(setMenu)
  }

  async function askRemove(game: Game) {
    setDialog(await removeGameQuestion(game, () => setOpenId(null)))
  }

  // The shared game menu (gameMenu.ts)
  function menuItems({ game, pinned, x, y }: GameMenu): MenuItem[] {
    return gameMenuItems(game, {
      pinned,
      onAskEnding: () => setEndingMenu({ game, pinned, x, y }),
      onWatch: () => {
        setOpenWatch(game.id)
        setOpenId(game.id)
      },
      onRemove: () => askRemove(game),
    })
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
              <p className="games-empty">To see upcoming games, set up the game search in Settings → Accounts.</p>
            )
          )
        ) : (
          <>
            {games && <DelayBanner games={games} onOpen={setOpenId} />}
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
                    {TABS.map(({ tab, label }) => {
                      const count = games.filter((g) => tabOf(g.status).tab === tab).length
                      let className = shown === tab ? 'active' : ''
                      if (lines.hovered === tab) className += ' hovered'
                      return (
                        <button key={tab} {...lines.tabProps(tab)} className={className} onClick={() => setShown(tab)}>
                          {label}
                          {count > 0 && <span className="games-count">{count}</span>}
                          <TabLines />
                        </button>
                      )
                    })}
                  </div>
                  {/* Library, with a Steam profile set (Settings → Accounts) */}
                  {shown === 'library' && steam?.steamId && (
                    <button className="games-import" onClick={() => setImporting(true)}>
                      <Download size={14} /> Import from Steam…
                    </button>
                  )}
                  <FillSwitch className="calendar-layouts games-layouts" options={SHELF_LAYOUTS} value={shelf} onChange={setShelf} />
                </div>
                {/* A new list for each tab and layout: switching isn't games coming and going */}
                {shown === 'toplay' ? (
                  <ToPlayShelf key={shelf} games={games} layout={shelf} onOpen={setOpenId} onMenu={openMenu} />
                ) : (
                  <GameShelf
                    key={`${shown}-${shelf}`}
                    games={sortGames(games.filter((g) => tabOf(g.status).tab === shown))}
                    layout={shelf}
                    emptyText={`No games in ${TABS.find((t) => t.tab === shown)!.label}`}
                    onOpen={setOpenId}
                    onMenu={openMenu}
                  />
                )}
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
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu)} onClose={() => setMenu(null)} />}
      {endingMenu && (
        <ContextMenu
          x={endingMenu.x}
          y={endingMenu.y}
          header={ENDING_HEADER}
          items={endingMenuItems(endingMenu.game)}
          onClose={() => setEndingMenu(null)}
        />
      )}
      {dialog && <Dialog request={dialog} onClose={() => setDialog(null)} />}
    </main>
  )
}

// To play: two parts, Playing above Not started (owned, not started), each with its title and count
function ToPlayShelf({ games, layout, onOpen, onMenu }: {
  games: Game[]
  layout: ShelfLayout
  onOpen: (id: string) => void
  onMenu: (game: Game, x: number, y: number) => void
}) {
  const parts = [
    { title: 'Playing', games: games.filter((g) => g.status === 'playing'), empty: 'Nothing being played right now.' },
    { title: 'Not started', games: games.filter((g) => g.status === 'upnext'), empty: "Games you own and haven't started yet." },
  ]
  return (
    <div className={layout === 'grid' ? 'games-parts wide' : 'games-parts'}>
      {parts.map((part) => (
        <section key={part.title} className="games-part">
          <h3 className="games-part-title">
            {part.title}
            {part.games.length > 0 && <span className="games-count">{part.games.length}</span>}
          </h3>
          {part.title === 'Playing' && part.games.length > 0 ? (
            <div className="playing-cards">
              {sortGames(part.games).map((game) => (
                <PlayingCard key={game.id} game={game} onOpen={() => onOpen(game.id)} onMenu={(x, y) => onMenu(game, x, y)} />
              ))}
            </div>
          ) : (
            <GameShelf games={sortGames(part.games)} layout={layout} emptyText={part.empty} onOpen={onOpen} onMenu={onMenu} />
          )}
        </section>
      ))}
    </div>
  )
}

// A game being played (To play's top part, both layouts): cover, name, "42 h played · since
// 21 Oct 2026" (hours only for Steam games; since = when it moved to Playing), "★ 4.5" once
// rated, and the Steam achievements bar (gold at 100%, like the game window). Wide cards side by
// side on the PC, slim full-width rows on the phone (CSS).
function PlayingCard({ game, onOpen, onMenu }: { game: Game; onOpen: () => void; onMenu: (x: number, y: number) => void }) {
  const stats = game.steamStats
  const percent = stats?.total ? Math.round(((stats.done ?? 0) / stats.total) * 100) : 0
  const since = `since ${shortDate(game.statusAt)}`
  const details = stats ? `${playedText(stats.minutes)} · ${since}` : since[0].toUpperCase() + since.slice(1)
  const ref = useRef<HTMLDivElement>(null)
  useListItem(ref)
  return (
    <div
      ref={ref}
      className={game.priority ? 'playing-card priority' : 'playing-card'}
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e.clientX, e.clientY)
      }}
    >
      <span className="game-row-cover">
        <Cover coverId={game.coverId} big />
        <GameBadge game={game} />
      </span>
      <div className="playing-text">
        <div className="playing-top">
          <div className="game-name" title={game.name}>{game.name}</div>
          {showsRated(game) && <GameRated game={game} />}
        </div>
        <div className="game-details">{details}</div>
        {!!stats?.total && (
          <div className={isHundred(stats) ? 'playing-achievements hundred' : 'playing-achievements'}>
            <div className="gd-bar" role="progressbar" aria-label="Achievements" aria-valuenow={percent}>
              <div style={{ width: `${percent}%` }} />
            </div>
            <span>
              {stats.done ?? 0} / {stats.total} achievements
            </span>
          </div>
        )}
      </div>
    </div>
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
        {game.preordered && <PreorderBadge />}
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
        {game.preordered && <PreorderBadge />}
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
// the game, so it shows on both devices. Also the games SyncR moved by itself (blue, first):
// "Released · now in To buy", "Started on Steam · now in Playing" (To play's part, clearer than
// the tab). Each line: small cover, the game's name, what happened under it; a click opens it.
const MOVED_LABELS = { released: 'Released', bought: 'Owned on Steam', started: 'Started on Steam' }

function DelayBanner({ games, onOpen }: { games: Game[]; onOpen: (id: string) => void }) {
  const moved = games.filter((g) => g.movedBy)
  const dated = games.filter((g) => g.datedFrom)
  const delayed = games.filter((g) => g.delayedFrom || g.delayedFromLabel)
  if (moved.length === 0 && dated.length === 0 && delayed.length === 0) return null
  return (
    <div className="games-delays">
      {moved.map((game) => (
        <NewsLine
          key={`moved-${game.id}`}
          game={game}
          kind="games-moved"
          icon={ArrowRight}
          what={MOVED_LABELS[game.movedBy!]}
          detail={`now in ${game.status === 'playing' ? 'Playing' : statusLabel(game.status)}`}
          onOpen={onOpen}
          onDismiss={() => updateGame(game.id, { movedBy: undefined })}
        />
      ))}
      {dated.map((game) => (
        <NewsLine
          key={`dated-${game.id}`}
          game={game}
          kind="games-dated"
          icon={CalendarCheck}
          what="Date set"
          detail={`${game.datedFrom} → ${formatRelease(game.releaseDate, game.releaseLabel)}`}
          onOpen={onOpen}
          onDismiss={() => updateGame(game.id, { datedFrom: undefined })}
        />
      ))}
      {delayed.map((game) => (
        <NewsLine
          key={game.id}
          game={game}
          kind=""
          icon={CalendarClock}
          what="Delayed"
          detail={`${formatRelease(game.delayedFrom, game.delayedFromLabel)} → ${formatRelease(game.releaseDate, game.releaseLabel)}`}
          onOpen={onOpen}
          onDismiss={() => updateGame(game.id, { delayedFrom: undefined, delayedFromLabel: undefined })}
        />
      ))}
    </div>
  )
}

function NewsLine({ game, kind, icon: Icon, what, detail, onOpen, onDismiss }: {
  game: Game
  kind: string // its color: games-moved (blue), games-dated (green), none (yellow)
  icon: typeof ArrowRight
  what: string
  detail: string
  onOpen: (id: string) => void
  onDismiss: () => void
}) {
  return (
    <div className={`games-delay ${kind}`}>
      <span className="games-delay-main" onClick={() => onOpen(game.id)}>
        <Cover coverId={game.coverId} />
        <span className="games-delay-text">
          <span className="games-delay-name" title={game.name}>{game.name}</span>
          <span className="games-delay-what">
            <Icon size={13} />
            <b>{what}</b> · {detail}
          </span>
        </span>
      </span>
      <button onClick={onDismiss} title="Dismiss">
        <X size={15} />
      </button>
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
    return <p className="games-empty">To search for games, set up the game search in Settings → Accounts.</p>
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
