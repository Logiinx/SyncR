import { useLayoutEffect, useRef } from 'react'
import { Gamepad2 } from 'lucide-react'
import { coverUrl } from './igdb'

// A cover image that fades in when it arrives (index.css, img[data-fade]); one already loaded
// (seen before, in the browser's memory) shows at once, so going back to a list doesn't flicker.
// Used by every cover: GameCover below, the game window and the search preview.
export function CoverImage({ src, className, lazy }: { src: string; className: string; lazy?: boolean }) {
  const ref = useRef<HTMLImageElement>(null)
  const arriving = useRef(false)
  useLayoutEffect(() => {
    const img = ref.current
    arriving.current = !img?.complete
    if (img && arriving.current) delete img.dataset.fade // a new cover in the same place fades again
  }, [src])
  return (
    <img
      ref={ref}
      className={className}
      src={src}
      alt=""
      loading={lazy ? 'lazy' : undefined}
      onLoad={(e) => {
        if (!arriving.current) return
        arriving.current = false
        e.currentTarget.dataset.fade = ''
      }}
    />
  )
}

// A game's cover: small in list rows, big in the My games grid (or a gamepad when IGDB has none)
function GameCover({ coverId, big }: { coverId?: string; big?: boolean }) {
  return coverId ? (
    <CoverImage className="game-cover" src={coverUrl(coverId, big ? 'cover_big' : 'cover_small')} lazy />
  ) : (
    <span className="game-cover game-cover-none">
      <Gamepad2 size={big ? 28 : 14} />
    </span>
  )
}

export default GameCover
