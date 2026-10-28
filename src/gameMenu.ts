import { ArrowRight, Bell, BellOff, Heart, Pin, PinOff, Sparkles, Trash2 } from 'lucide-react'
import { canWatch, isWatched, pinGameToBoard, pinnedCard, setGameStatus, unpinGameFromBoard, updateGame, type Game } from './db'
import { isFavoriteTab, priorityLabel, STATUSES } from './games'
import { stopWatching } from './priceWatch'
import type { MenuItem } from './ContextMenu'

// A game's right-click menu, the same wherever a game of your list shows (Games, Reminders).
// Three groups: Move to … | priority, price alert, Board (priority first, like a Board card's
// menu) | Remove. "Watch price…" and "Remove from list" are up to the view (they open its windows).
export function gameMenuItems(game: Game, view: { pinned: boolean; onWatch: () => void; onRemove: () => void }): MenuItem[] {
  return [
    ...STATUSES.filter((s) => s.status !== game.status).map(({ status, label }) => ({
      label: `Move to ${label}`,
      icon: ArrowRight,
      onClick: () => setGameStatus(game.id, status),
    })),
    {
      label: priorityLabel(game),
      icon: isFavoriteTab(game) ? Heart : Sparkles,
      divider: true,
      onClick: () => updateGame(game.id, { priority: !game.priority }),
    },
    // To play and Waiting: the price alert, set in the game window
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

// The menu to open at x, y: whether the game has a Board card ("Pin to Board" or "Unpin from
// Board") is looked up once here, not kept up to date while no menu is open
export type GameMenu = { game: Game; x: number; y: number; pinned: boolean }

export async function gameMenuAt(game: Game, x: number, y: number): Promise<GameMenu> {
  return { game, x, y, pinned: !!(await pinnedCard(game.id)) }
}
