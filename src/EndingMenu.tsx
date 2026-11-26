import ContextMenu from './ContextMenu'
import type { Game } from './db'
import { endingHeader, endingMenuItems } from './gameMenu'

// "How did it end?": the question asked when a game leaves Playing for the Library (its menu's
// "Move to Library" in Games and Reminders, the Library button in its window). Picking one moves it.
export default function EndingMenu({ game, x, y, onClose }: { game: Game; x: number; y: number; onClose: () => void }) {
  return <ContextMenu x={x} y={y} header={endingHeader()} items={endingMenuItems(game)} onClose={onClose} />
}
