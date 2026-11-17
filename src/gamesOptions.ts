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
  changed()
}

export const useShortPlaytime = () => useSyncExternalStore(subscribe, () => shortPlaytime)

// Playing cards: "42 h / ⌛ 52 h" instead of "42 h played · ⌛ 52 h" (user: off at first)
const JOIN_KEY = 'syncr.games.joinTimes'
let joinTimes = read(JOIN_KEY, false)

export function setJoinTimes(value: boolean) {
  joinTimes = value
  write(JOIN_KEY, value)
  changed()
}

export const useJoinTimes = () => useSyncExternalStore(subscribe, () => joinTimes)

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function changed() {
  for (const listener of listeners) listener()
}
