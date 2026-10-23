import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { GameStatus } from './db'
import { ADD_PLACES, statusLabel, type AddPlace } from './games'
import ContextMenu from './ContextMenu'

// The end of a game row in the search results and the Games calendar: "In To play" once the game
// is in your list, else an "Add" button (onAdd decides which list). With onAddTo (released games
// in the search): a split button, "Add" in one click, "▾" for the other places (ADD_PLACES).
function AddOrInList({ status, onAdd, onAddTo }: {
  status?: GameStatus
  onAdd: () => void
  onAddTo?: (place: AddPlace) => void
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  if (status) return <span className="game-in-list">In {statusLabel(status)}</span>
  return (
    // Clicks here aren't the row's own click (it opens the preview)
    <span className={onAddTo ? 'add-split' : 'add-single'} onClick={(e) => e.stopPropagation()}>
      <button className="setting-button" onClick={onAdd}>
        Add
      </button>
      {onAddTo && (
        <button
          className="setting-button add-more"
          title="Add to…"
          onClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect()
            setMenu({ x: box.left, y: box.bottom + 4 })
          }}
        >
          <ChevronDown size={14} />
        </button>
      )}
      {menu && onAddTo && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={ADD_PLACES.map((place) => ({ label: place.label, onClick: () => onAddTo(place) }))}
          onClose={() => setMenu(null)}
        />
      )}
    </span>
  )
}

export default AddOrInList
