import { useEffect } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { igdbProxyFetch, isComplete, useConnection } from './igdb'
import { useLocalState } from './localState'

// The Video tab: a feed of new videos from followed YouTube and Twitch channels. For the owner's
// own use for now: it only exists when their Worker says it's on (VIDEO_FEED, see
// proxy/igdb-worker.js). Everyone else sees nothing. PC only for now.

export const VIDEO_TAB = 'video' // its id among the open tabs (like GAMES_TAB)

const available = isTauri() || import.meta.env.DEV

// The Worker's answer, or null when it can't give one now (offline, Cloudflare trouble).
// Refused or unknown (a Worker without the video routes) = off.
async function askStatus() {
  try {
    const response = await igdbProxyFetch('video/status', '', 10_000)
    if (response.status >= 500) return null
    if (!response.ok) return false
    return (await response.json()).enabled === true
  } catch {
    return null
  }
}

// Whether to show the Video tab. Remembered, so it's there at once on start and when offline.
// Asked again at each start, and when the Worker's address or password changes (after a pause,
// as they're typed letter by letter in Settings).
export function useVideoEnabled() {
  const connection = useConnection()
  const [enabled, setEnabled] = useLocalState('syncr.videoFeed', false)
  const url = connection?.url
  const password = connection?.password
  useEffect(() => {
    if (!available || url === undefined) return // undefined: not loaded yet
    if (!isComplete({ url, password: password ?? '' })) {
      setEnabled(false)
      return
    }
    let stale = false
    const timer = setTimeout(() => {
      void askStatus().then((answer) => {
        if (!stale && answer !== null) setEnabled(answer)
      })
    }, 1000)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [url, password, setEnabled])
  return available && enabled
}
