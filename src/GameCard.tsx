import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Ellipsis } from 'lucide-react'
import { changed, db, setCardColor, setCardPriority, type Card } from './db'
import { colorMenuItems, tintStyle } from './cardColors'
import ContextMenu from './ContextMenu'
import Cover from './GameCover'

interface Props {
  card: Card & { game: NonNullable<Card['game']> }
  onDelete: () => void
  onPress: (event: React.PointerEvent) => void // may start a drag (Board.tsx)
  onOpen: (gameId: string) => void // the game's details
  onMoveToGroup: (x: number, y: number) => void // "Move to group…" (Board.tsx)
}

// A game pinned to the Board ("Pin to Board" in the Games tab): cover and name. Moves, gets
// priority and is unpinned like any card (Card.tsx: its menu), but has no text to edit. Click: the game's details
// (only while the game is in your list). Shows the game's current name and cover, and keeps
// its own copy of them up to date, so the card still shows if the game is removed later.
function GameCard({ card, onDelete, onPress, onOpen, onMoveToGroup }: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; colors?: boolean } | null>(null)
  const game = useLiveQuery(() => db.games.get(card.game.id), [card.game.id])
  const inList = !!game && !game.deleted
  const name = inList ? game.name : card.game.name
  const coverId = inList ? game.coverId : card.game.coverId

  // The game's name or cover changed (e.g. the daily refresh): update the card's copy
  useEffect(() => {
    if (!inList || (game.name === card.game.name && game.coverId === card.game.coverId)) return
    db.cards
      .update(card.id, {
        game: { id: game.id, name: game.name, coverId: game.coverId },
        text: game.name,
        updatedAt: Date.now(),
      })
      .then(changed)
  }, [inList, game, card])

  return (
    <div
      className={`card game-card${card.priority ? ' priority' : ''}${card.color ? ' colored' : ''}${inList ? '' : ' removed'}`}
      style={tintStyle(card.color)}
      data-card-id={card.id}
      title={inList ? undefined : 'No longer in your games'}
      onPointerDown={(event) => {
        if (!(event.target as HTMLElement).closest('button')) onPress(event)
      }}
      onClick={(event) => {
        if (inList && !(event.target as HTMLElement).closest('button')) onOpen(card.game.id)
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        setMenu({ x: event.clientX, y: event.clientY })
      }}
    >
      <Cover coverId={coverId} />
      <span className="game-card-name">{name}</span>
      <div className="card-buttons">
        {/* Phone only (CSS): opens the menu (a long press moves the card) */}
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
          items={menu.colors ? colorMenuItems(card.color, (color) => setCardColor(card.id, color)) : [
            ...(inList ? [{ label: 'Open', onClick: () => onOpen(card.game.id) }] : []),
            {
              label: card.priority ? 'Remove priority' : 'Mark as priority',
              divider: true,
              onClick: () => setCardPriority(card.id, !card.priority),
            },
            { label: 'Color…', onClick: () => setMenu({ ...menu, colors: true }) },
            { label: 'Move to group…', onClick: () => onMoveToGroup(menu.x, menu.y) },
            { label: 'Unpin from Board', danger: true, divider: true, onClick: onDelete },
          ]}
        />
      )}
    </div>
  )
}

export default GameCard
