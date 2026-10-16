import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronDown, ChevronRight, Flag, Gamepad2, Search, X } from 'lucide-react'
import { db, setGameStatus, updateGame, type Game, type GameStatus } from './db'
import { addGame, formatRelease, gameId, sortGames, STATUSES } from './games'
import { coverUrl, isConnected, searchGames, type FoundGame } from './igdb'
import ContextMenu, { type MenuItem } from './ContextMenu'
import GameDialog, { starText } from './GameDialog'
import Dialog, { type DialogRequest } from './Dialog'
import { useLocalState } from './localState'

// The Games tab: your games in groups by status, and a search (IGDB) to add more.
// Click a game for its details (GameDialog.tsx); right-click / long press for a quick menu.

const SEARCH_DELAY = 400 // ms after the last key before searching

function GamesView() {
  const games = useLiveQuery(() => db.games.filter((game) => !game.deleted).toArray(), [])
  // Closed groups, remembered per device (e.g. a long Done list folded away)
  const [closed, setClosed] = useLocalState<Partial<Record<GameStatus, boolean>>>('syncr.gamesClosed', {})
  const [menu, setMenu] = useState<{ game: Game; x: number; y: number } | null>(null)
  const [dialog, setDialog] = useState<DialogRequest | null>(null)
  const [openId, setOpenId] = useState<string | null>(null) // the game whose details are shown

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
      { label: game.priority ? 'Remove flag' : 'Flag', onClick: () => updateGame(game.id, { priority: !game.priority }) },
      { label: 'Remove from list', danger: true, onClick: () => askRemove(game) },
    ]
  }

  return (
    <main className="page games-page">
      <div className="games">
        <GameSearch inList={new Map(games?.map((g) => [g.id, g.status]))} />
        {games && games.length === 0 && isConnected() && (
          <p className="games-empty">
            <Gamepad2 size={18} /> Search for a game above to start your list.
          </p>
        )}
        {games &&
          games.length > 0 &&
          STATUSES.map(({ status, label }) => {
            const group = sortGames(games.filter((g) => g.status === status))
            if (group.length === 0) return null
            const isClosed = !!closed[status]
            return (
              <section key={status} className="games-group">
                <button className="games-group-title" onClick={() => setClosed({ ...closed, [status]: !isClosed })}>
                  {isClosed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  {label} <span className="games-count">{group.length}</span>
                </button>
                {!isClosed &&
                  group.map((game) => (
                    <GameRow
                      key={game.id}
                      game={game}
                      onOpen={() => setOpenId(game.id)}
                      onMenu={(x, y) => openMenu(game, x, y)}
                    />
                  ))}
              </section>
            )
          })}
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

function Cover({ coverId }: { coverId?: string }) {
  return coverId ? (
    <img className="game-cover" src={coverUrl(coverId)} alt="" loading="lazy" />
  ) : (
    <span className="game-cover game-cover-none">
      <Gamepad2 size={14} />
    </span>
  )
}

// One game: cover, name, release (full date while waiting, else the year), platforms, and a
// preview of the review (finished or dropped games) or the note. Stars and heart on the right.
function GameRow({ game, onOpen, onMenu }: { game: Game; onOpen: () => void; onMenu: (x: number, y: number) => void }) {
  const played = game.status === 'done' || game.status === 'dropped'
  const when =
    game.status === 'waiting' || !game.releaseDate
      ? formatRelease(game.releaseDate)
      : String(new Date(game.releaseDate).getFullYear())
  const text = (played && game.review.trim()) || game.note.trim()
  const preview = text && (played && game.review.trim() ? `“${text}”` : text)
  const details = [when, game.platforms.join(', '), preview].filter(Boolean).join(' · ')
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
        <div className="game-name">{game.name}</div>
        <div className="game-details">{details}</div>
      </div>
      {(game.rating || game.liked) && (
        <span className="game-rated">
          {starText(game.rating)}
          {game.liked && <span className="game-liked"> ♥</span>}
        </span>
      )}
      {game.priority && <Flag size={14} className="game-flag" aria-label="Flagged" />}
    </div>
  )
}

// The search box at the top. Results show below it; "Add" puts a game in the list.
function GameSearch({ inList }: { inList: Map<string, GameStatus> }) {
  const [text, setText] = useState('')
  const [includeDlc, setIncludeDlc] = useLocalState('syncr.gamesIncludeDlc', false)
  const [results, setResults] = useState<FoundGame[] | null>(null)
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

  if (!isConnected()) {
    return <p className="games-empty">To search for games, set up the game search in Settings → Games.</p>
  }

  const label = (status?: GameStatus) => STATUSES.find((s) => s.status === status)?.label
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
            const status = inList.get(gameId(found.igdbId))
            return (
              <div key={found.igdbId} className="game-row">
                <Cover coverId={found.coverId} />
                <div className="game-text">
                  <div className="game-name">{found.name}</div>
                  <div className="game-details">
                    {[formatRelease(found.releaseDate), found.platforms.join(', ')].filter(Boolean).join(' · ')}
                  </div>
                </div>
                {status ? (
                  <span className="game-in-list">In {label(status)}</span>
                ) : (
                  <button className="setting-button" onClick={() => addGame(found)}>
                    Add
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default GamesView
