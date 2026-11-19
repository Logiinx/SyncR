import { isTauri } from '@tauri-apps/api/core'
import { openLink } from './links'
import { read } from './localState'
import { findVideo, markOpened } from './video'
import { playVideo } from './videoPlayer'
import { linkTime } from './videoPaste'

// A note's link to one video (a card or a plain link) plays in SyncR's player on the PC, without
// adding it to the Video lists (one already there plays as from the Video tab). Only where the
// Video tab shows (its Worker said yes); anything else, or a video the Worker can't find, opens in
// the browser as before. Channels, playlists and clips open in the browser too.

// youtube.com/watch?v=…, /shorts/…, /live/…, /embed/…, youtu.be/…, twitch.tv/videos/…
export function isVideoLink(href: string) {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return false
  }
  if (!/^https?:$/.test(url.protocol)) return false
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '')
  const path = url.pathname
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    return (path === '/watch' && !!url.searchParams.get('v')) || /^\/(shorts|live|embed)\/[\w-]{6,}/.test(path)
  }
  if (host === 'youtu.be') return /^\/[\w-]{6,}/.test(path)
  if (host === 'twitch.tv') return /^\/videos\/\d+/.test(path)
  return false
}

// SyncR's player can be used here: the desktop app, where the Video tab shows (the key
// useVideoEnabled in video.ts remembers; reading it asks the Worker nothing)
export const playerHere = () => isTauri() && read('syncr.videoFeed', false)

// A click on it plays it in the player (then its right-click menu offers the browser)
export const playsHere = (href: string) => playerHere() && isVideoLink(href)

export function openLinkOrPlay(href: string) {
  if (!playsHere(href)) return openLink(href)
  void findVideo(href)
    .then(({ video, playlistId }) => {
      playVideo(video, playlistId, linkTime(new URL(href)))
      void markOpened(video.id)
    })
    .catch((error) => {
      console.error('Video link lookup failed', error)
      openLink(href)
    })
}
