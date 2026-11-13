import { useSyncExternalStore } from 'react'
import { read, write } from './localState'

// How far each video got, on this PC. The player window's pages can't call the app, so they send
// it through video_window.rs (video-watch.js, every 5 s). Opening a video again puts this in its address.
export interface VideoPosition {
  t: number // seconds
  length: number
}
const KEY = 'syncr.videoPositions'
const KEPT = 200
const JUST_STARTED = 30 // seconds: under this, it starts from the beginning again
const NEARLY_DONE = 120 // seconds from the end, or NEARLY_DONE_SHARE of it when that's shorter
const NEARLY_DONE_SHARE = 0.05

let positions = read<Record<string, VideoPosition>>(KEY, {})
const listeners = new Set<() => void>()

export function savePosition(videoId: string, position: VideoPosition) {
  const kept = { ...positions }
  delete kept[videoId] // also puts it back as the newest
  kept[videoId] = position
  positions = Object.fromEntries(Object.entries(kept).slice(-KEPT))
  write(KEY, positions)
  for (const listener of listeners) listener()
}

// Start over: these start from the beginning again
export function forgetPositions(videoIds: string[]) {
  const kept = { ...positions }
  for (const id of videoIds) delete kept[id]
  positions = kept
  write(KEY, positions)
  for (const listener of listeners) listener()
}

// It counts as finished: it starts from the beginning again, and may move to Watched (videoPlayer.ts)
export const nearlyDone = ({ t, length }: VideoPosition) => length - t <= Math.min(NEARLY_DONE, length * NEARLY_DONE_SHARE)

const unfinished = (position: VideoPosition | undefined) =>
  position && position.t >= JUST_STARTED && !nearlyDone(position) ? position : null

// Where it would continue, or null when it starts from the beginning
export const resumePosition = (videoId: string) => unfinished(positions[videoId])

export function useResumePosition(videoId: string) {
  const position = useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, () => positions[videoId])
  return unfinished(position)
}

// 1:02:03, or 48:32 under an hour (unless withHours: 0:48:32)
export function videoClock(time: number, withHours = false) {
  const seconds = Math.floor(time)
  const part = (value: number) => String(value).padStart(2, '0')
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return hours || withHours ? `${hours}:${part(minutes)}:${part(seconds % 60)}` : `${minutes}:${part(seconds % 60)}`
}
