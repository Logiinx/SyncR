import { useEffect, useState, useSyncExternalStore } from 'react'
import { read, write } from './localState'

// New videos for the pop-up (PC): those of follows with the bell (Follows window) that a check
// finds while SyncR runs (video.ts). Only their ids are kept, in localStorage, which the pop-up
// window reads too and follows through "storage" events; it reads the rest (title, picture,
// channel) from the database, sealed like the notes on the PC.
export interface VideoAlert {
  id: string // the video's ("youtube-…")
  at: number // when it was found (ms)
}
const KEY = 'syncr.video.alerts'
const MAX = 20 // more than this waiting: the oldest go (the pop-up shows "N new videos" anyway)

export const loadVideoAlerts = () => read<VideoAlert[]>(KEY, [])

function save(alerts: VideoAlert[]) {
  write(KEY, alerts)
  window.dispatchEvent(new Event('video-alerts-change')) // this window; others get "storage"
}

// Newest first
export function addVideoAlerts(ids: string[]) {
  const alerts = loadVideoAlerts()
  const known = new Set(alerts.map((alert) => alert.id))
  const now = Date.now()
  const added = ids.filter((id) => !known.has(id)).map((id) => ({ id, at: now }))
  if (added.length) save([...added, ...alerts].slice(0, MAX))
}

export function removeVideoAlerts(ids: string[]) {
  const gone = new Set(ids)
  const alerts = loadVideoAlerts()
  if (alerts.some((alert) => gone.has(alert.id))) save(alerts.filter((alert) => !gone.has(alert.id)))
}

// The cards to show, kept current (also from the other window)
export function useVideoAlerts() {
  const [alerts, setAlerts] = useState(loadVideoAlerts)
  useEffect(() => {
    const refresh = () => setAlerts(loadVideoAlerts())
    const onStorage = (e: StorageEvent) => e.key === KEY && refresh()
    window.addEventListener('video-alerts-change', refresh)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('video-alerts-change', refresh)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  return alerts
}

// The cards' size (Settings → Video, this PC): Large = the Video tab's hover card, Compact =
// a small picture beside the title. Followed in both windows.
export type PopupCardSize = 'large' | 'compact'
const SIZE_KEY = 'syncr.video.popupCards'
const sizeListeners = new Set<() => void>()
let size = read<PopupCardSize>(SIZE_KEY, 'large')

export function setPopupCardSize(next: PopupCardSize) {
  size = next
  write(SIZE_KEY, next)
  sizeListeners.forEach((listener) => listener())
}

window.addEventListener('storage', (e) => {
  if (e.key !== SIZE_KEY) return
  size = read<PopupCardSize>(SIZE_KEY, 'large')
  sizeListeners.forEach((listener) => listener())
})

export function usePopupCardSize() {
  return useSyncExternalStore((listener) => {
    sizeListeners.add(listener)
    return () => sizeListeners.delete(listener)
  }, () => size)
}
