import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { t, textKey } from './i18n'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowRight, CalendarCheck, CalendarClock, Download, Gamepad2, LayoutGrid, List, Search, Settings, X } from 'lucide-react'
import GamesSettings from './GamesSettings'
import { canWatch, db, isWatched, updateGame, type Game, type GameStatus } from './db'
import { addGame, formatRelease, gameId, isPlayed, isReleased, releaseText, removeGameQuestion, shortPlatforms, sortGames, statusLabel, tabOf, TABS, type GamesTab } from './games'
import { endingHeader, endingMenuItems, gameMenuAt, gameMenuItems, type GameMenu } from './gameMenu'
import { GamePriceLine, PlaytimeShort, useShortTime } from './GameExtrasView'
import { PlaytimesContext, usePlaytimes } from './playtimes'
import { useJoinTimes, usePricesRight } from './gamesOptions'
import { hasPriceLine, loadListPrices, usePricesVersion } from './prices'
import { PreorderBadge, WatchBell } from './PriceWatchView'
import { isHundred, PLAYING_ON_OPEN, playedText, playedTime, refreshPlaying, useSteamProfile } from './steam'
import SteamImport from './SteamImport'
import { isComplete, searchGames, useConnection, type FoundGame, type SameAs } from './igdb'
import Cover from './GameCover'
import AddOrInList from './AddOrInList'
import GameCalendar, { calendarLayouts, DEFAULT_TOP, TOP_LEVELS, type CalendarLayout } from './GameCalendar'
import ContextMenu, { type MenuItem } from './ContextMenu'
import GameDialog, { AchievementBar, GameBadge, gameClass, GameRated, showsRated } from './GameDialog'
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
const views = (): { value: GamesViewName; label: string }[] => [
  { value: 'mine', label: t('My games') },
  { value: 'calendar', label: t('Calendar') },
]
const shelfLayouts = (): { value: ShelfLayout; label: React.ReactNode; title: string }[] => [
  { value: 'grid', label: <LayoutGrid size={15} />, title: t('Covers') },
  { value: 'list', label: <List size={15} />, title: t('List') },
]

function GamesView() {
  const pageRef = useRef<HTMLElement>(null)
  usePage(pageRef)
  // The pinned My games | Calendar row's height: the status tabs stick right under it
  const barRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const bar = barRef.current
    const page = pageRef.current
    if (!bar || !page) return
    const observer = new ResizeObserver(() => page.style.setProperty('--games-bar-height', `${bar.offsetHeight}px`))
    observer.observe(bar)
    return () => observer.disconnect()
  }, [])
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
  const [settingsOpen, setSettingsOpen] = useState(false) // the Games settings window
  // Playing games' Steam hours and achievements, unless looked at in the last 5 minutes
  useEffect(() => {
    refreshPlaying(PLAYING_ON_OPEN)
  }, [])
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
  // The same menu from the search results and the calendar (they know only the game's id)
  function openMenuOf(id: string, x: number, y: number) {
    const game = games?.find((g) => g.id === id)
    if (game) openMenu(game, x, y)
  }

  async function askRemove(game: Game) {
    setDialog(await removeGameQuestion(game, () => setOpenId(null)))
  }

  // The shared game menu (gameMenu.ts)
  function menuItems({ game, pinned, hltbId, x, y }: GameMenu): MenuItem[] {
    return gameMenuItems(game, {
      pinned,
      hltbId,
      onAsk: setDialog,
      onAskEnding: () => setEndingMenu({ game, pinned, x, y }),
      onWatch: () => {
        setOpenWatch(game.id)
        setOpenId(game.id)
      },
      onRemove: () => askRemove(game),
    })
  }

  const inList = new Map(games?.map((g) => [g.id, g.status]))
  const playtimes = usePlaytimes()
  return (
    <PlaytimesContext.Provider value={playtimes}>
    <main className="page games-page" ref={pageRef}>
      {/* Wide only for the month grid (not for the "set up the game search" text, which then
          sat further left than in My games) */}
      <div className={view === 'calendar' && layout === 'grid' && connected ? 'games wide' : 'games'}>
        <div ref={barRef} className={view === 'calendar' && connected ? 'games-views calendar-head pinned-bar' : 'games-views pinned-bar'}>
          <FillSwitch className="games-views-switch" options={views()} value={view} onChange={setView} />
          {/* Only with the game search set up: otherwise they do nothing, and the taller header
              put the "set up the game search" text lower than in My games */}
          {view === 'calendar' && connected && (
            <div className="calendar-controls">
              <FillSwitch
                className="calendar-top"
                title={t("How many of Steam's most wishlisted upcoming games to show")}
                before={t('Top')}
                options={TOP_LEVELS.map((level) => ({ value: level, label: level }))}
                value={top}
                onChange={setTop}
              />
              <FillSwitch className="calendar-layouts" options={calendarLayouts()} value={layout} onChange={setLayout} />
            </div>
          )}
        </div>
        {view === 'calendar' ? (
          connected ? (
            <GameCalendar inList={inList} layout={layout} top={top} onOpen={setOpenId} onMenu={openMenuOf} />
          ) : (
            connection && (
              <p className="games-empty">{t('To see upcoming games, set up the game search in Settings → Accounts.')}</p>
            )
          )
        ) : (
          <>
            {games && <DelayBanner games={games} onOpen={setOpenId} />}
            <GameSearch inList={inList} onOpen={setOpenId} onMenu={openMenuOf} />
            {games && games.length === 0 && connected && (
              <p className="games-empty">
                <Gamepad2 size={18} />
                <span>
                  {t('Search for a game above to start your list')}
                  {steam?.steamId ? (
                    <>
                      {t(', or')}{' '}
                      <button className="games-empty-import" onClick={() => setImporting(true)}>
                        {t('import from Steam…')}
                      </button>
                    </>
                  ) : '.'}
                </span>
              </p>
            )}
            {importing && <SteamImport onClose={() => setImporting(false)} />}
            {settingsOpen && <GamesSettings onClose={() => setSettingsOpen(false)} />}
            {games && games.length > 0 && (
              <>
                {/* Underlined tabs, each a quarter of the row, with an icon (an empty status shows no
                    count); as wide as the cover grid. Import and the layout switch on a row below. */}
                <div className={shelf === 'grid' ? 'games-status-tabs pinned-bar wide' : 'games-status-tabs pinned-bar'}>
                  {/* Scrolls sideways when the screen is too narrow (phone, big app scale) */}
                  <div className="games-status-list" ref={statusList} onPointerLeave={lines.onRowLeave}>
                    {TABS.map(({ tab, label, icon: TabIcon }) => {
                      const count = games.filter((g) => tabOf(g.status).tab === tab).length
                      let className = shown === tab ? 'active' : ''
                      if (lines.hovered === tab) className += ' hovered'
                      return (
                        <button key={tab} {...lines.tabProps(tab)} className={className} onClick={() => setShown(tab)}>
                          <TabIcon size={16} className="games-tab-icon" />
                          {t(label)}
                          {count > 0 && <span className="games-count">{count}</span>}
                          <TabLines />
                        </button>
                      )
                    })}
                  </div>
                  <div className="games-tools">
                    {/* Library, with a Steam profile set (Settings → Accounts) */}
                    {shown === 'library' && steam?.steamId && (
                      <button className="games-import" onClick={() => setImporting(true)}>
                        <Download size={14} /> {t('Import from Steam…')}
                      </button>
                    )}
                    <FillSwitch className="calendar-layouts games-layouts" options={shelfLayouts()} value={shelf} onChange={setShelf} />
                    <button className="games-import games-settings-button" title={t('Games settings')} onClick={() => setSettingsOpen(true)}>
                      <Settings size={14} />
                    </button>
                  </div>
                </div>
                {/* A new list for each tab and layout (switching isn't games coming and going),
                    which fades in quickly */}
                <div key={`${shown}-${shelf}`} className="games-tab-in">
                  {shown === 'toplay' ? (
                    <ToPlayShelf games={games} layout={shelf} onOpen={setOpenId} onMenu={openMenu} />
                  ) : (
                    <GameShelf
                      games={sortGames(games.filter((g) => tabOf(g.status).tab === shown))}
                      layout={shelf}
                      emptyText={t('No games in {place}', { place: t(TABS.find((tab) => tab.tab === shown)!.label) })}
                      onOpen={setOpenId}
                      onMenu={openMenu}
                    />
                  )}
                </div>
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
          header={endingHeader()}
          items={endingMenuItems(endingMenu.game)}
          onClose={() => setEndingMenu(null)}
        />
      )}
      {dialog && <Dialog request={dialog} onClose={() => setDialog(null)} />}
    </main>
    </PlaytimesContext.Provider>
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
    { status: 'playing', title: t('Playing'), games: games.filter((g) => g.status === 'playing'), empty: t('Nothing being played right now') },
    { status: 'upnext', title: t('Not started'), games: games.filter((g) => g.status === 'upnext'), empty: t("Games you own and haven't started yet") },
  ]
  return (
    <div className={layout === 'grid' ? 'games-parts wide' : 'games-parts'}>
      {parts.map((part) => (
        <section key={part.status} className={part.status === 'playing' ? 'games-part' : 'games-part later'}>
          <h3 className="games-part-title">
            {part.title}
            {part.games.length > 0 && <span className="games-count">{part.games.length}</span>}
          </h3>
          {part.status === 'playing' && part.games.length > 0 ? (
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

// A game being played (To play's top part, both layouts): cover, name, "42 h played · ⌛ 52 h"
// (hours only for Steam games), "★ 4.5" once rated, and the Steam achievements bar (gold at 100%,
// like the game window), then the game's note when it has one (dim, 2 lines at most, all of it in
// its tooltip). A line too long wraps between its pieces (user: nothing cut off). Wide cards side
// by side on the PC, slim full-width rows on the phone (CSS).
function PlayingCard({ game, onOpen, onMenu }: { game: Game; onOpen: () => void; onMenu: (x: number, y: number) => void }) {
  const stats = game.steamStats
  const time = useShortTime(game.id)
  // What you played next to the HowLongToBeat time (Games settings): "42 h played · ⌛ 52 h", or
  // "42 h / ⌛ 52 h" when joined (Games settings; only when both show)
  const joined = useJoinTimes() && !!stats && time > 0
  const details = joined
    ? dotted([
        <>
          <span title={playedText(stats.minutes)}>{playedTime(stats.minutes)}</span>
          {' / '}
          <PlaytimeShort seconds={time} />
        </>,
      ])
    : dotted([stats && playedText(stats.minutes), time > 0 && <PlaytimeShort seconds={time} />])
  // The note's lines joined by " · " (blank ones skipped), so 2 lines show as much as they can
  const note = game.note
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' · ')
  const ref = useRef<HTMLDivElement>(null)
  useListItem(ref)
  return (
    <div
      ref={ref}
      className={gameClass('playing-card', game)}
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
        {details.length > 0 && <div className="game-details">{details}</div>}
        {!!stats?.total && <PlayingAchievements stats={stats} />}
        {note && (
          <div className="playing-note" title={game.note.trim()}>
            {note}
          </div>
        )}
      </div>
    </div>
  )
}

// A Playing card's achievements: the bar, then "12 / 40 achievements", or just "12 / 40" when the
// card is too narrow to leave the bar some room (user: shorten only when needed). The full text
// stays in the row, invisible, to be measured.
const MIN_BAR = 60
function PlayingAchievements({ stats }: { stats: NonNullable<Game['steamStats']> }) {
  const ref = useRef<HTMLDivElement>(null)
  const fullRef = useRef<HTMLSpanElement>(null)
  const [short, setShort] = useState(false)
  const done = stats.done ?? 0
  const total = stats.total ?? 0
  const full = t('{done} / {total} achievements', { done, total })
  useLayoutEffect(() => {
    const row = ref.current
    const label = fullRef.current
    if (!row || !label) return
    const gap = parseFloat(getComputedStyle(row).columnGap) || 0
    const check = () => setShort(label.offsetWidth + gap + MIN_BAR > row.clientWidth)
    check()
    const observer = new ResizeObserver(check)
    observer.observe(row)
    return () => observer.disconnect()
  }, [full])
  return (
    <div ref={ref} className={isHundred(stats) ? 'playing-achievements hundred' : 'playing-achievements'} title={short ? full : undefined}>
      <AchievementBar stats={stats} />
      <span ref={fullRef} className={short ? 'playing-achievements-measure' : undefined} aria-hidden={short || undefined}>
        {full}
      </span>
      {short && <span>{`${done} / ${total}`}</span>}
    </div>
  )
}

// Parts of a details line with " · " between those that show. Each part stays whole; a line that
// wraps breaks after a dot, never before it (no line starts with "·").
function dotted(parts: ReactNode[]) {
  return parts.filter(Boolean).map((part, index) => (
    <Fragment key={index}>
      {index > 0 && ' · '}
      <span className="game-details-part">{part}</span>
    </Fragment>
  ))
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
  const time = useShortTime(game.id)
  const ref = useRef<HTMLDivElement>(null)
  useListItem(ref)
  const prices = hasPriceLine(game)
  const pricesRight = usePricesRight() && prices
  // The year, countdown or rating, and the HowLongToBeat time at the right
  const line = (
    <div className="game-tile-line">
      {showsRated(game) ? <GameRated game={game} /> : <div className="game-details">{when}</div>}
      {time > 0 && <PlaytimeShort seconds={time} />}
    </div>
  )
  return (
    <div
      ref={ref}
      className={gameClass('game-tile', game)}
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
      {pricesRight ? (
        <PricesRight>
          {line}
          <GamePriceLine igdbId={game.igdbId} />
        </PricesRight>
      ) : (
        <>
          {line}
          {prices && <GamePriceLine igdbId={game.igdbId} />}
        </>
      )}
    </div>
  )
}

// "Prices on the right of covers" (Games settings): the tile's line and its prices as two columns,
// the time under the year and the key under Steam. Where they don't fit side by side (narrow tile,
// long countdown, sale tag) or there are no prices, the usual layout. Checked again whenever a part changes size: the
// window's width, prices or times arriving.
function PricesRight({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [fits, setFits] = useState(true)
  useLayoutEffect(() => {
    const box = ref.current
    if (!box) return
    const check = () => {
      // Try the columns, see whether they stick out, then keep whichever layout fits. No prices
      // (none known): the usual single line, shorter.
      box.classList.add('stacked')
      const ok = !!box.querySelector('.game-price-line') && box.scrollWidth <= box.clientWidth
      box.classList.toggle('stacked', ok)
      setFits(ok)
    }
    check()
    const watch = new ResizeObserver(check)
    watch.observe(box)
    for (const part of box.children) watch.observe(part)
    // A part that shows later (prices still loading) is watched too
    const parts = new MutationObserver(() => {
      for (const part of box.children) watch.observe(part)
      check()
    })
    parts.observe(box, { childList: true, subtree: true, characterData: true })
    return () => {
      watch.disconnect()
      parts.disconnect()
    }
  }, [])
  return (
    <div ref={ref} className={fits ? 'game-tile-prices stacked' : 'game-tile-prices'}>
      {children}
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
  const time = useShortTime(game.id)
  const ref = useRef<HTMLDivElement>(null)
  useListItem(ref)
  return (
    <div
      ref={ref}
      className={gameClass('game-row', game)}
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
        <div className="game-details" title={details}>
          {dotted([releaseText(game, 'year'), time > 0 && <PlaytimeShort seconds={time} />, preview])}
        </div>
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
const MOVED_LABELS = { released: textKey('Released'), bought: textKey('Owned on Steam'), started: textKey('Started on Steam') }

function DelayBanner({ games, onOpen }: { games: Game[]; onOpen: (id: string) => void }) {
  const moved = games.filter((g) => g.movedBy)
  const dated = games.filter((g) => g.datedFrom !== undefined)
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
          what={t(MOVED_LABELS[game.movedBy!])}
          detail={t('now in {place}', { place: game.status === 'playing' ? t('Playing') : statusLabel(game.status)! })}
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
          what={t('Date set')}
          detail={fromTo(formatRelease(game.datedFromDay, game.datedFrom || undefined), formatRelease(game.releaseDate, game.releaseLabel))}
          onOpen={onOpen}
          onDismiss={() => updateGame(game.id, { datedFrom: undefined, datedFromDay: undefined })}
        />
      ))}
      {delayed.map((game) => (
        <NewsLine
          key={game.id}
          game={game}
          kind=""
          icon={CalendarClock}
          what={t('Delayed')}
          detail={fromTo(formatRelease(game.delayedFrom, game.delayedFromLabel), formatRelease(game.releaseDate, game.releaseLabel))}
          onOpen={onOpen}
          onDismiss={() => updateGame(game.id, { delayedFrom: undefined, delayedFromLabel: undefined })}
        />
      ))}
    </div>
  )
}

// "TBA → 2028" with the dim arrow icon of the sale table (never a typed arrow)
const fromTo = (from: string, to: string) => (
  <>
    {from}
    <ArrowRight className="sale-arrow" aria-hidden />
    {to}
  </>
)

function NewsLine({ game, kind, icon: Icon, what, detail, onOpen, onDismiss }: {
  game: Game
  kind: string // its color: games-moved (blue), games-dated (green), none (yellow)
  icon: typeof ArrowRight
  what: string
  detail: ReactNode
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
      <button onClick={onDismiss} title={t('Dismiss')}>
        <X size={15} />
      </button>
    </div>
  )
}

// The search box at the top. Results show below it; "Add" puts a game in the list. Click a result
// for a preview (GamePreview.tsx), or for its details if it's already in your list.
function GameSearch({ inList, onOpen, onMenu }: {
  inList: Map<string, GameStatus>
  onOpen: (id: string) => void
  onMenu: (id: string, x: number, y: number) => void // a game in your list: its right-click menu
}) {
  const connection = useConnection() // undefined while loading
  const connected = isComplete(connection)
  const [text, setText] = useState('')
  const [includeDlc, setIncludeDlc] = useLocalState('syncr.gamesIncludeDlc', false)
  const [results, setResults] = useState<FoundGame[] | null>(null)
  const [sameAs, setSameAs] = useState<Map<number, SameAs>>(new Map())
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
          setResults(found.games)
          setSameAs(found.sameAs)
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
    return <p className="games-empty">{t('To search for games, set up the game search in Settings → Accounts.')}</p>
  }

  return (
    <div className="game-search">
      <div className="game-search-bar">
        <Search size={15} />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setText('')}
          placeholder={t('Search for a game to add')}
          spellCheck={false}
        />
        {searching && <Spinner label={t('Searching')} />}
        {text && (
          <button className="game-search-clear" onClick={() => setText('')} title={t('Clear')}>
            <X size={15} />
          </button>
        )}
      </div>
      <label className="game-search-dlc">
        <input type="checkbox" checked={includeDlc} onChange={(e) => setIncludeDlc(e.target.checked)} />
        {t('Include DLCs, editions and bundles')}
      </label>
      {error && <p className="game-search-message error">{error}</p>}
      {results && !error && (
        <div className="game-results">
          {results.length === 0 && !searching && <p className="game-search-message">{t('No games found')}</p>}
          {results.map((found) => {
            const id = gameId(found.igdbId)
            const status = inList.get(id)
            const same = sameAs.get(found.igdbId)
            const sameText = same && (same.kind === 'steam' ? t('Same game as {name} on Steam', { name: same.name }) : t('No Steam page of its own · see {name}', { name: same.name }))
            return (
              <div
                key={found.igdbId}
                className={`game-row game-result${same ? ' same-as' : ''}`}
                onClick={() => (status ? onOpen(id) : setPreview(found))}
                onContextMenu={(e) => {
                  if (!status) return
                  e.preventDefault()
                  onMenu(id, e.clientX, e.clientY)
                }}
              >
                <Cover coverId={found.coverId} />
                <div className="game-text">
                  <div className="game-name" title={found.name}>{found.name}</div>
                  <div className="game-details" title={sameText}>
                    {sameText || [releaseText(found, 'full'), shortPlatforms(found.platforms)].filter(Boolean).join(' · ')}
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
