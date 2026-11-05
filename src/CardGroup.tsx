import { useRef, useState } from 'react'
import { plural, t } from './i18n'
import { ChevronDown, Ellipsis, Layers, PaintBucket, Palette, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import { deleteGroup, setCardPriority, setGroupColor, updateCardTitle, type Card } from './db'
import { colorMenuItems, tintStyle } from './cardColors'
import ContextMenu from './ContextMenu'
import { closeCopy, useFoldAnimation, useList, useListItem } from './animations'
import type { DialogRequest } from './Dialog'

interface Props {
  group: Card
  cards: Card[] // the cards in it
  onPress: (event: React.PointerEvent) => void // pressed on the header: may start a drag (Board.tsx)
  onDialog: (request: DialogRequest) => void // rename / delete questions (shown by the Board)
  onDeleted: (ids: string[]) => void // deleted: what "Undo" brings back
  onNewCard: () => void // menu → New card: added at the bottom of the group (Board.tsx)
  children: React.ReactNode // its cards, already in order
}

// A group of cards on the Board ("Move to group" in a card's menu): a header with a stack icon,
// the name and how many cards are in it; its cards under it, a bit indented, joined by a line.
// Clicking the header folds them away (synced). Folded, it looks like a small pile of cards,
// so it can't be mistaken for a folded card with a title.
// Its menu (right-click on the header; "⋯" on the phone): new card, rename, priority, delete.
function CardGroup({ group, cards, onPress, onDialog, onDeleted, onNewCard, children }: Props) {
  // colors: one of the color lists instead of the menu (the group only, or with its cards)
  const [menu, setMenu] = useState<{ x: number; y: number; colors?: 'group' | 'all' } | null>(null)
  const count = cards.length
  const name = group.title ?? ''

  function rename() {
    onDialog({
      title: t('Rename group'),
      input: { initial: name, placeholder: t('Group name') },
      confirmLabel: t('Rename'),
      onConfirm: (value) => value.trim() && updateCardTitle(group.id, { title: value.trim() }),
    })
  }

  function askDelete() {
    onDialog({
      title: t('Delete group?'),
      message: count
        ? t('The group "{name}" will be removed. Its cards go back on the Board, unless you tick the box.', { name })
        : t('The group "{name}" will be removed.', { name }),
      ...(count > 0 && { checkbox: plural(count, 'Delete its card too', 'Delete its {n} cards too') }),
      confirmLabel: t('Delete'),
      danger: true,
      onConfirm: async (_, withCards) => onDeleted(await deleteGroup(group.id, withCards)),
    })
  }

  // A color list: the group only, or the group and its cards (then checked only when they
  // all have that color too)
  function colorItems(withCards: boolean) {
    const current = withCards && cards.some((card) => card.color !== group.color) ? null : group.color
    return colorMenuItems(current, (color) => setGroupColor(group.id, color, withCards))
  }

  const cardsElement = () =>
    document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(group.id)}"] > .card-group-cards`)
  useFoldAnimation(!!group.folded, cardsElement)
  const ref = useRef<HTMLDivElement>(null)
  useListItem(ref)
  const cardsRef = useRef<HTMLDivElement>(null)
  useList(cardsRef)

  const className = ['card-group', group.priority && 'priority', group.color && 'colored', group.folded && 'folded']
    .filter(Boolean)
    .join(' ')
  return (
    <div className={className} style={tintStyle(group.color)} data-card-id={group.id} ref={ref}>
      <div
        className="card-group-head"
        onPointerDown={(event) => {
          if (event.button === 0 && !(event.target as HTMLElement).closest('button')) onPress(event)
        }}
        onClick={(event) => {
          if (!(event.target as HTMLElement).closest('button')) {
            if (!group.folded) closeCopy(cardsElement())
            updateCardTitle(group.id, { folded: group.folded ? undefined : true })
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          setMenu({ x: event.clientX, y: event.clientY })
        }}
        title={group.folded ? t('Unfold') : t('Fold')}
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
          title={t('More')}
        >
          <Ellipsis size={13} />
        </button>
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          header={menu.colors ? { title: menu.colors === 'all' ? t('Color with its cards') : t('Group color') } : undefined}
          items={menu.colors ? colorItems(menu.colors === 'all') : [
            {
              label: t('New card'),
              icon: Plus,
              onClick: () => {
                if (group.folded) updateCardTitle(group.id, { folded: undefined }) // unfolded to show it
                onNewCard()
              },
            },
            { label: t('Rename'), icon: Pencil, onClick: rename },
            { label: t('Group color…'), icon: Palette, divider: true, onClick: () => setMenu({ ...menu, colors: 'group' }) },
            { label: t('Color with its cards…'), icon: PaintBucket, onClick: () => setMenu({ ...menu, colors: 'all' }) },
            {
              label: group.priority ? t('Remove priority') : t('Mark as priority'),
              icon: Sparkles,
              divider: true,
              onClick: () => setCardPriority(group.id, !group.priority),
            },
            { label: t('Delete group'), icon: Trash2, danger: true, onClick: askDelete },
          ]}
        />
      )}
      {!group.folded && (
        <div className="card-group-cards" ref={cardsRef}>{count ? children : <div className="card-group-empty">{t('No cards')}</div>}</div>
      )}
    </div>
  )
}

export default CardGroup
