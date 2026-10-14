import { useEffect, useState } from 'react'

// Per-device settings (open tabs, sidebar, scroll) kept in localStorage.
// Never synced. If storage is unavailable, the app still works and just forgets.

export function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore: storage full or blocked
  }
}

// Like useState, but the value is remembered after a restart.
export function useLocalState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => read(key, initial))
  useEffect(() => write(key, value), [key, value])
  return [value, setValue] as const
}

// ---------- Scroll positions, one per note ----------

export interface ScrollPos {
  top: number
  atBottom: boolean
}

const SCROLL_KEY = 'syncr.scroll'

export function getScroll(noteId: string): ScrollPos | undefined {
  return read<Record<string, ScrollPos>>(SCROLL_KEY, {})[noteId]
}

export function setScroll(noteId: string, pos: ScrollPos) {
  const all = read<Record<string, ScrollPos>>(SCROLL_KEY, {})
  all[noteId] = pos
  write(SCROLL_KEY, all)
}

export function forgetScroll(noteId: string) {
  const all = read<Record<string, ScrollPos>>(SCROLL_KEY, {})
  delete all[noteId]
  write(SCROLL_KEY, all)
}
