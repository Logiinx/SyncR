import { Gamepad2 } from 'lucide-react'
import { coverUrl } from './igdb'

// A game's small cover in list rows (or a gamepad when IGDB has none)
function GameCover({ coverId }: { coverId?: string }) {
  return coverId ? (
    <img className="game-cover" src={coverUrl(coverId)} alt="" loading="lazy" />
  ) : (
    <span className="game-cover game-cover-none">
      <Gamepad2 size={14} />
    </span>
  )
}

export default GameCover
