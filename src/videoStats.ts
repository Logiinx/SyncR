import { useEffect, useSyncExternalStore } from 'react'
import { igdbProxyFetch } from './igdb'

// A video's views and likes now, for its hover card (VideoView.tsx): asked from the Worker the first
// time its card shows, then kept in memory until the app closes (saved, they'd go stale). likes is
// null when the uploader hides them, and on Twitch (no likes there).
export interface VideoStats {
  views: number | null
  likes: number | null
}

// Per video id ("youtube-abc"): its numbers, or null when there are none to show (gone). A failed
// ask shows nothing either, but the next hover asks again.
const known = new Map<string, VideoStats | null>()
const asking = new Set<string>()
const failed = new Set<string>()
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((listener) => listener())

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

async function ask(videoId: string, platform: string) {
  if (known.has(videoId) || asking.has(videoId)) return
  asking.add(videoId)
  failed.delete(videoId)
  changed()
  try {
    const response = await igdbProxyFetch('video/stats', JSON.stringify({ platform, id: videoId.slice(platform.length + 1) }), 15_000)
    if (!response.ok) throw new Error(String(response.status))
    const answer = await response.json()
    known.set(videoId, answer.gone ? null : { views: answer.views ?? null, likes: answer.likes ?? null })
  } catch {
    failed.add(videoId) // offline, a slow answer, or an older Worker without video/stats
  } finally {
    asking.delete(videoId)
    changed()
  }
}

// undefined while asking, null when there's nothing to show
export function useVideoStats(video: { id: string; platform: string; gone?: boolean }) {
  useEffect(() => {
    if (!video.gone) void ask(video.id, video.platform)
  }, [video.id, video.platform, video.gone])
  return useSyncExternalStore(subscribe, () => (video.gone || failed.has(video.id) ? null : known.get(video.id)))
}
