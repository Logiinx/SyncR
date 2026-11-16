import { useSyncExternalStore } from 'react'
import { read, write } from './localState'

// What the Video tab's hover cards show (Video settings → Hover cards, this PC): one checkbox per
// piece, all on at first. A kind of card with all its pieces off doesn't show at all.
export const VIDEO_PIECES = ['videoPicture', 'videoDetails', 'videoStats'] as const // i18n-ok
export const LIST_PIECES = ['listPicture', 'listCounts', 'listTime', 'listLatest'] as const // i18n-ok
export type CardPiece = (typeof VIDEO_PIECES)[number] | (typeof LIST_PIECES)[number]

const KEY = 'syncr.video.cardPiecesOff'
let off: readonly CardPiece[] = read<CardPiece[]>(KEY, [])
const listeners = new Set<() => void>()

export function setCardPiece(piece: CardPiece, on: boolean) {
  off = on ? off.filter((other) => other !== piece) : [...off.filter((other) => other !== piece), piece]
  write(KEY, off)
  for (const listener of listeners) listener()
}

// Which pieces are on, followed live
export function useCardPieces() {
  const now = useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, () => off)
  return (piece: CardPiece) => !now.includes(piece)
}
