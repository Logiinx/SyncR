import { useEffect, useState } from 'react'
import { read, write } from './localState'
import type { PlayableVideo } from './videoPlayer'

// The pop-up's "Added to queue" card (PC): a copied video the global shortcut sent to the Queue
// (videoPaste.ts). One at a time, the latest; it fades by itself after FADE_SECONDS
// (ReminderPopup.tsx), Watch plays it, ✕ closes it. Kept in localStorage so the pop-up window,
// which has its own page, sees it (like the mouse battery's card).
export interface QueuedNote {
  video: PlayableVideo
  playlistId?: string
  channel: string
  already: boolean // it was in the Queue already
  at: number // ms; also the card's key, so a newer one starts its own fade
}
const KEY = 'syncr.video.queuedNote'
export const QUEUED_FADE_SECONDS = 5
const FADE_PREFIX = 'queued:' // i18n-ok
export const queuedFadeKey = (at: number) => FADE_PREFIX + at
// The card's time from its fade key, or null for another card's key
export const queuedAtOf = (key: string) => (key.startsWith(FADE_PREFIX) ? key.slice(FADE_PREFIX.length) : null)

export const loadQueuedNote = () => read<QueuedNote | null>(KEY, null)

export function saveQueuedNote(note: QueuedNote | null) {
  write(KEY, note)
  window.dispatchEvent(new Event('queued-note-change')) // this window; others get "storage"
}

// Watch, ✕ or faded: only the card it was about (a newer one stays)
export function closeQueuedNote(at: number) {
  if (loadQueuedNote()?.at === at) saveQueuedNote(null)
}

export function useQueuedNote() {
  const [note, setNote] = useState(loadQueuedNote)
  useEffect(() => {
    const refresh = () => setNote(loadQueuedNote())
    const onStorage = (e: StorageEvent) => e.key === KEY && refresh()
    window.addEventListener('queued-note-change', refresh)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('queued-note-change', refresh)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  return note
}
