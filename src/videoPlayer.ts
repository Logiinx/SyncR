import { invoke, isTauri } from '@tauri-apps/api/core'
import { openLink } from './links'

// The video player window (desktop only; lib.rs, open_video_player). In a browser, videos just
// open in a new tab.
interface PlayableVideo {
  id: string
  platform: 'youtube' | 'twitch'
  title: string
  url: string
}

// YouTube: its player-only page, where the wait it puts before a video when ads are blocked
// doesn't happen. video-forward.html opens it: that page refuses to play without knowing the
// address it was opened from. Twitch: its normal page.
function playerAddress(video: PlayableVideo) {
  if (video.platform !== 'youtube') return video.url
  return `video-forward.html?v=${encodeURIComponent(video.id.slice('youtube-'.length))}`
}

// Clicks one after the other, so two quick ones can't both create the window
let queue = Promise.resolve()

export function playVideo(video: PlayableVideo) {
  if (!isTauri()) {
    openLink(video.url)
    return
  }
  queue = queue
    .then(() => invoke<void>('open_video_player', { address: playerAddress(video), title: video.title }))
    .catch((error) => {
      console.error('Video player failed', error)
      openLink(video.url) // still gets to watch it
    })
}
