import { Gamepad2 } from 'lucide-react'
import { coverUrl } from './igdb'

// A game's cover: small in list rows, big in the My games grid (or a gamepad when IGDB has none)
function GameCover({ coverId, big }: { coverId?: string; big?: boolean }) {
  return coverId ? (
    <img className="game-cover" src={coverUrl(coverId, big ? 'cover_big' : 'cover_small')} alt="" loading="lazy" />
  ) : (
    <span className="game-cover game-cover-none">
      <Gamepad2 size={big ? 28 : 14} />
    </span>
  )
}

export default GameCover
