import { ChevronDown, Layers } from 'lucide-react'
import { updateCardTitle, type Card } from './db'

interface Props {
  group: Card
  count: number // cards in it
  onPress: (event: React.PointerEvent) => void // pressed on the header: may start a drag (Board.tsx)
  children: React.ReactNode // its cards, already in order
}

// A group of cards on the Board ("Move to group" in a card's menu): a header with a stack icon,
// the name and how many cards are in it; its cards under it, a bit indented, joined by a line.
// Clicking the header folds them away (synced). Folded, it looks like a small pile of cards,
// so it can't be mistaken for a folded card with a title.
function CardGroup({ group, count, onPress, children }: Props) {
  const className = ['card-group', group.priority && 'priority', group.folded && 'folded'].filter(Boolean).join(' ')
  return (
    <div className={className} data-card-id={group.id}>
      <div
        className="card-group-head"
        onPointerDown={(event) => {
          if (event.button === 0) onPress(event)
        }}
        onClick={() => updateCardTitle(group.id, { folded: group.folded ? undefined : true })}
        title={group.folded ? 'Unfold' : 'Fold'}
      >
        <ChevronDown size={14} className="card-group-chevron" />
        <Layers size={14} className="card-group-icon" />
        <span className="card-group-name">{group.title}</span>
        <span className="card-group-count">{count}</span>
      </div>
      {!group.folded && (
        <div className="card-group-cards">{count ? children : <div className="card-group-empty">No cards</div>}</div>
      )}
    </div>
  )
}

export default CardGroup
