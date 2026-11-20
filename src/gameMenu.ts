import { Archive, ArrowDown, ArrowRight, ArrowUp, Bell, BellOff, CircleCheck, CirclePause, CircleX, ExternalLink, Heart, Hourglass, PackageCheck, PackageX, Pin, PinOff, Play, Sparkles, Trash2 } from 'lucide-react'
import { t, textKey, type TextKey } from './i18n'
import { canWatch, db, isWatched, pinGameToBoard, pinnedCard, setGameStatus, setPreordered, unpinGameFromBoard, updateGame, type Game } from './db'
import { endingChange, endingOf, isFavoriteTab, isReleased, moveToLibrary, priorityLabel, STATUSES, type Ending } from './games'
import { stopWatching } from './priceWatch'
import type { MenuItem } from './ContextMenu'
import type { DialogRequest } from './Dialog'
import { openLink } from './links'
import { playtimeLink, playtimePageQuestion } from './playtimes'
import { moveInPlayOrder, playOrderPlace } from './playOrder'

// A game's right-click menu, the same wherever a game of your list shows (Games, Reminders).
// Groups: Move to … ("Start playing" for Playing) | Not started on a touch screen: Move up / Move
// down in the play order (the PC drags instead) | Library: how it ended | priority, price alert,
// Board (priority first), HowLongToBeat's page (open it, or paste another one: view.onAsk shows the
// box) | Remove. "Watch price…" and "Remove from list" are up to the view (they open its windows).
// With onAskEnding, "Move to Library" from Playing asks how it ended first (endingMenuItems).
export function gameMenuItems(
  game: Game,
  view: { pinned: boolean; hltbId?: number | null; place?: PlayPlace; onWatch: () => void; onRemove: () => void; onAsk: (request: DialogRequest) => void; onAskEnding?: () => void },
): MenuItem[] {
  return [
    ...STATUSES.filter((s) => s.status !== game.status).map(({ status, label }) => ({
      label: status === 'playing' ? t('Start playing') : t('Move to {place}', { place: t(label) }),
      icon: status === 'playing' ? Play : ArrowRight,
      ...(upcomingClosed(game, status) && { disabled: true, hint: t('Already out') }),
      onClick: () =>
        status === 'library' && game.status === 'playing' && view.onAskEnding
          ? view.onAskEnding()
          : setGameStatus(game.id, status),
    })),
    ...(!view.place ? [] : [
      { label: t('Move up'), icon: ArrowUp, divider: true, disabled: view.place.first, hint: view.place.first ? t('Already first') : undefined, onClick: () => moveInPlayOrder(game, -1) },
      { label: t('Move down'), icon: ArrowDown, disabled: view.place.last, hint: view.place.last ? t('Already last') : undefined, onClick: () => moveInPlayOrder(game, 1) },
    ]),
    // Library: how it ended, like the game window's pills (✓ = the current one, again = none)
    ...(game.status !== 'library' ? [] : ENDINGS.filter((e) => e.ending).map(({ ending, label, icon }, i) => {
      const on = endingOf(game) === ending
      return { label: t(label), icon, checked: on, divider: i === 0, onClick: () => updateGame(game.id, endingChange(on ? undefined : ending)) }
    })),
    {
      label: priorityLabel(game),
      icon: isFavoriteTab(game) ? Heart : Sparkles,
      divider: true,
      onClick: () => updateGame(game.id, { priority: !game.priority }),
    },
    // Upcoming: pre-ordered or not (a pre-order has no price alert)
    ...(game.status !== 'waiting' ? [] : game.preordered
      ? [{ label: t('Not pre-ordered'), icon: PackageX, onClick: () => setPreordered(game.id, false) }]
      : [{ label: t('Mark as pre-ordered'), icon: PackageCheck, onClick: () => setPreordered(game.id, true) }]),
    // To buy and Upcoming: the price alert, set in the game window
    ...(!canWatch(game) ? [] : isWatched(game)
      ? [{ label: t('Stop watching'), icon: BellOff, onClick: () => stopWatching(game) }]
      : [{ label: t('Watch price…'), icon: Bell, onClick: view.onWatch }]),
    view.pinned
      ? { label: t('Unpin from Board'), icon: PinOff, onClick: () => unpinGameFromBoard(game.id) }
      : {
          label: t('Pin to Board'),
          icon: Pin,
          onClick: async () => {
            await pinGameToBoard(game)
            window.dispatchEvent(new Event('open-board')) // show it (App.tsx)
          },
        },
    // Grayed while its page isn't known (not found, or not asked yet)
    { label: t('Open on HowLongToBeat'), icon: ExternalLink, disabled: !view.hltbId, onClick: () => openLink(playtimeLink(view.hltbId!)) },
    { label: t('HowLongToBeat page…'), icon: Hourglass, onClick: () => view.onAsk(playtimePageQuestion(game, view.onAsk)) },
    { label: t('Remove from list'), icon: Trash2, danger: true, onClick: view.onRemove },
  ]
}

// A game that's out can't go (back) to Upcoming: the release day check would move it straight out
// again, with a "Released" line. Grayed in the menu and the game window's status switch.
export const upcomingClosed = (game: Game, status: Game['status']) =>
  status === 'waiting' && game.status !== 'waiting' && isReleased(game)

// How a game ended, in the Library (✓ = the current one). Asked when a Playing game moves to the
// Library ("How did it end?" menu, Games tab and game window), also the game window's choices.
export const ENDINGS: { ending?: Ending; label: TextKey; icon: typeof Archive }[] = [
  { ending: 'completed', label: textKey('Completed'), icon: CircleCheck },
  { ending: 'paused', label: textKey('Paused'), icon: CirclePause },
  { ending: 'dropped', label: textKey('Dropped'), icon: CircleX },
  { label: textKey('Just put away'), icon: Archive },
]
export const endingMenuItems = (game: Game): MenuItem[] =>
  ENDINGS.map(({ ending, label, icon }) => ({
    label: t(label),
    icon,
    checked: endingOf(game) === ending && !!ending,
    onClick: () => moveToLibrary(game.id, ending),
  }))
export const endingHeader = () => ({ title: t('How did it end?'), subtitle: t('Moves it to the Library') })

// The menu to open at x, y: whether the game has a Board card ("Pin to Board" or "Unpin from
// Board") and its HowLongToBeat page are looked up once here, not kept up to date while no menu is open
// On a touch screen, a Not started game's place in the play order (Move up / Move down).
type PlayPlace = { first: boolean; last: boolean }
export type GameMenu = { game: Game; x: number; y: number; pinned: boolean; hltbId?: number | null; place?: PlayPlace }

const touchScreen = () => !matchMedia('(hover: hover) and (pointer: fine)').matches
export async function gameMenuAt(game: Game, x: number, y: number): Promise<GameMenu> {
  const [card, playtime, place] = await Promise.all([
    pinnedCard(game.id),
    db.playtimes.get(game.id),
    game.status === 'upnext' && touchScreen() ? playOrderPlace(game) : undefined,
  ])
  return { game, x, y, pinned: !!card, hltbId: playtime?.hltbId, place }
}
