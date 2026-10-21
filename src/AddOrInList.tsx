import type { GameStatus } from './db'
import { statusLabel } from './games'

// The end of a game row in the search results and the Games calendar: "In To play" once the game
// is in your list, else an "Add" button (onAdd decides which list)
function AddOrInList({ status, onAdd }: { status?: GameStatus; onAdd: () => void }) {
  if (status) return <span className="game-in-list">In {statusLabel(status)}</span>
  return (
    <button
      className="setting-button"
      onClick={(e) => {
        e.stopPropagation() // not the row's own click (it opens the preview)
        onAdd()
      }}
    >
      Add
    </button>
  )
}

export default AddOrInList
