import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Sparkles, X } from 'lucide-react'
import { changed, db, setCardPriority, type Card } from './db'
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
// priority and is deleted like any card (Card.tsx), but has no text to edit. Click: the game's details
// (only while the game is in your list). Shows the game's current name and cover, and keeps
// its own copy of them up to date, so the card still shows if the game is removed later.
function GameCard({ card, onDelete, onPress, onOpen, onMoveToGroup }: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
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
      className={`card game-card${card.priority ? ' priority' : ''}${inList ? '' : ' removed'}`}
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
        <button
          className="card-priority"
          onClick={() => setCardPriority(card.id, !card.priority)}
          title={card.priority ? 'Remove priority' : 'Mark as priority'}
        >
          <Sparkles size={12} />
        </button>
        <button className="card-delete" onClick={onDelete} title="Unpin from Board">
          <X size={13} />
        </button>
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            ...(inList ? [{ label: 'Open', onClick: () => onOpen(card.game.id) }] : []),
            {
              label: card.priority ? 'Remove priority' : 'Mark as priority',
              onClick: () => setCardPriority(card.id, !card.priority),
            },
            { label: 'Move to group…', onClick: () => onMoveToGroup(menu.x, menu.y) },
            { label: 'Unpin from Board', danger: true, onClick: onDelete },
          ]}
        />
      )}
    </div>
  )
}

export default GameCard
