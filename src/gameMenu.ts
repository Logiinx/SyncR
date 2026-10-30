import { Archive, ArrowRight, Bell, BellOff, CircleCheck, CirclePause, CircleX, Heart, PackageCheck, PackageX, Pin, PinOff, Play, Sparkles, Trash2 } from 'lucide-react'
import { canWatch, isWatched, pinGameToBoard, pinnedCard, setGameStatus, setPreordered, unpinGameFromBoard, updateGame, type Game } from './db'
import { endingChange, endingOf, isFavoriteTab, moveToLibrary, priorityLabel, STATUSES, type Ending } from './games'
import { stopWatching } from './priceWatch'
import type { MenuItem } from './ContextMenu'

// A game's right-click menu, the same wherever a game of your list shows (Games, Reminders).
// Groups: Move to … ("Start playing" for Playing) | Library: how it ended | priority, price alert,
// Board (priority first, like a Board card's menu) | Remove. "Watch price…" and "Remove from list" are up to the view (they open its windows).
// With onAskEnding, "Move to Library" from Playing asks how it ended first (endingMenuItems).
export function gameMenuItems(
  game: Game,
  view: { pinned: boolean; onWatch: () => void; onRemove: () => void; onAskEnding?: () => void },
): MenuItem[] {
  return [
    ...STATUSES.filter((s) => s.status !== game.status).map(({ status, label }) => ({
      label: status === 'playing' ? 'Start playing' : `Move to ${label}`,
      icon: status === 'playing' ? Play : ArrowRight,
      onClick: () =>
        status === 'library' && game.status === 'playing' && view.onAskEnding
          ? view.onAskEnding()
          : setGameStatus(game.id, status),
    })),
    // Library: how it ended, like the game window's pills (✓ = the current one, again = none)
    ...(game.status !== 'library' ? [] : ENDINGS.filter((e) => e.ending).map(({ ending, label, icon }, i) => {
      const on = endingOf(game) === ending
      return { label, icon, checked: on, divider: i === 0, onClick: () => updateGame(game.id, endingChange(on ? undefined : ending)) }
    })),
    {
      label: priorityLabel(game),
      icon: isFavoriteTab(game) ? Heart : Sparkles,
      divider: true,
      onClick: () => updateGame(game.id, { priority: !game.priority }),
    },
    // Upcoming: pre-ordered or not (a pre-order has no price alert)
    ...(game.status !== 'waiting' ? [] : game.preordered
      ? [{ label: 'Not pre-ordered', icon: PackageX, onClick: () => setPreordered(game.id, false) }]
      : [{ label: 'Mark as pre-ordered', icon: PackageCheck, onClick: () => setPreordered(game.id, true) }]),
    // To buy and Upcoming: the price alert, set in the game window
    ...(!canWatch(game) ? [] : isWatched(game)
      ? [{ label: 'Stop watching', icon: BellOff, onClick: () => stopWatching(game) }]
      : [{ label: 'Watch price…', icon: Bell, onClick: view.onWatch }]),
    view.pinned
      ? { label: 'Unpin from Board', icon: PinOff, onClick: () => unpinGameFromBoard(game.id) }
      : {
          label: 'Pin to Board',
          icon: Pin,
          onClick: async () => {
            await pinGameToBoard(game)
            window.dispatchEvent(new Event('open-board')) // show it (App.tsx)
          },
        },
    { label: 'Remove from list', icon: Trash2, danger: true, onClick: view.onRemove },
  ]
}

// How a game ended, in the Library (✓ = the current one). Asked when a Playing game moves to the
// Library ("How did it end?" menu, Games tab and game window), also the game window's choices.
export const ENDINGS: { ending?: Ending; label: string; icon: typeof Archive }[] = [
  { ending: 'completed', label: 'Completed', icon: CircleCheck },
  { ending: 'paused', label: 'Paused', icon: CirclePause },
  { ending: 'dropped', label: 'Dropped', icon: CircleX },
  { label: 'Just put away', icon: Archive },
]
export const endingMenuItems = (game: Game): MenuItem[] =>
  ENDINGS.map(({ ending, label, icon }) => ({
    label,
    icon,
    checked: endingOf(game) === ending && !!ending,
    onClick: () => moveToLibrary(game.id, ending),
  }))
export const ENDING_HEADER = { title: 'How did it end?', subtitle: 'Moves it to the Library' }

// The menu to open at x, y: whether the game has a Board card ("Pin to Board" or "Unpin from
// Board") is looked up once here, not kept up to date while no menu is open
export type GameMenu = { game: Game; x: number; y: number; pinned: boolean }

export async function gameMenuAt(game: Game, x: number, y: number): Promise<GameMenu> {
  return { game, x, y, pinned: !!(await pinnedCard(game.id)) }
}
