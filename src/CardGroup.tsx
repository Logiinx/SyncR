import { useState } from 'react'
import { ChevronDown, Ellipsis, Layers } from 'lucide-react'
import { deleteGroup, setCardPriority, updateCardTitle, type Card } from './db'
import ContextMenu from './ContextMenu'
import type { DialogRequest } from './Dialog'

interface Props {
  group: Card
  count: number // cards in it
  onPress: (event: React.PointerEvent) => void // pressed on the header: may start a drag (Board.tsx)
  onDialog: (request: DialogRequest) => void // rename / delete questions (shown by the Board)
  onDeleted: (ids: string[]) => void // deleted: what "Undo" brings back
  children: React.ReactNode // its cards, already in order
}

// A group of cards on the Board ("Move to group" in a card's menu): a header with a stack icon,
// the name and how many cards are in it; its cards under it, a bit indented, joined by a line.
// Clicking the header folds them away (synced). Folded, it looks like a small pile of cards,
// so it can't be mistaken for a folded card with a title.
// Its menu (right-click on the header; "⋯" on the phone): rename, priority, delete.
function CardGroup({ group, count, onPress, onDialog, onDeleted, children }: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const name = group.title ?? ''

  function rename() {
    onDialog({
      title: 'Rename group',
      input: { initial: name, placeholder: 'Group name' },
      confirmLabel: 'Rename',
      onConfirm: (value) => value.trim() && updateCardTitle(group.id, { title: value.trim() }),
    })
  }

  function askDelete() {
    onDialog({
      title: 'Delete group?',
      message: count
        ? `The group "${name}" will be removed. Its cards go back on the Board, unless you tick the box.`
        : `The group "${name}" will be removed.`,
      ...(count > 0 && { checkbox: count === 1 ? 'Delete its card too' : `Delete its ${count} cards too` }),
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async (_, withCards) => onDeleted(await deleteGroup(group.id, withCards)),
    })
  }

  const className = ['card-group', group.priority && 'priority', group.folded && 'folded'].filter(Boolean).join(' ')
  return (
    <div className={className} data-card-id={group.id}>
      <div
        className="card-group-head"
        onPointerDown={(event) => {
          if (event.button === 0 && !(event.target as HTMLElement).closest('button')) onPress(event)
        }}
        onClick={(event) => {
          if (!(event.target as HTMLElement).closest('button')) {
            updateCardTitle(group.id, { folded: group.folded ? undefined : true })
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          setMenu({ x: event.clientX, y: event.clientY })
        }}
        title={group.folded ? 'Unfold' : 'Fold'}
      >
        <ChevronDown size={14} className="card-group-chevron" />
        <Layers size={14} className="card-group-icon" />
        <span className="card-group-name">{group.title}</span>
        <span className="card-group-count">{count}</span>
        {/* Phone only (CSS): opens the menu (a long press moves the group) */}
        <button
          className="card-more"
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect()
            setMenu({ x: box.left, y: box.bottom + 4 })
          }}
          title="More"
        >
          <Ellipsis size={13} />
        </button>
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Rename', onClick: rename },
            {
              label: group.priority ? 'Remove priority' : 'Mark as priority',
              onClick: () => setCardPriority(group.id, !group.priority),
            },
            { label: 'Delete group', danger: true, onClick: askDelete },
          ]}
        />
      )}
      {!group.folded && (
        <div className="card-group-cards">{count ? children : <div className="card-group-empty">No cards</div>}</div>
      )}
    </div>
  )
}

export default CardGroup
