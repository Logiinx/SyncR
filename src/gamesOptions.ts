import { useSyncExternalStore } from 'react'
import { read, write } from './localState'

// The Games settings window's choices (GamesSettings.tsx). This device only, like grid / list.

// Which HowLongToBeat time shows on the Games page's tiles, rows and Playing cards (GameExtrasView's
// PlaytimeShort); the game window always shows them all
export type ShortPlaytime = 'off' | 'main' | 'plus' | 'full'
const PLAYTIME_KEY = 'syncr.games.playtime'
let shortPlaytime = read<ShortPlaytime>(PLAYTIME_KEY, 'main')
const listeners = new Set<() => void>()

export function setShortPlaytime(value: ShortPlaytime) {
  shortPlaytime = value
  write(PLAYTIME_KEY, value)
  for (const listener of listeners) listener()
}

export const useShortPlaytime = () =>
  useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, () => shortPlaytime)
