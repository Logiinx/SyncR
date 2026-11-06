import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { currentZoom } from './appearance'
import { t } from './i18n'
import { openLink } from './links'
import { read, write } from './localState'
import { setWatched, watchWatched } from './video'

// The video player window (desktop only; lib.rs, open_video_player). In a browser, videos just
// open in a new tab.
interface PlayableVideo {
  id: string
  platform: 'youtube' | 'twitch'
  title: string
  url: string
  watched: boolean
}

// Per device, like the rest of the Video tab
interface PlayerSettings {
  alwaysOnTop: boolean
  watchedCloses: boolean // Watched on the bar also closes the window
}
const KEY = 'syncr.videoPlayer'
export const loadPlayerSettings = () => ({ alwaysOnTop: false, watchedCloses: false, ...read<Partial<PlayerSettings>>(KEY, {}) })
export function savePlayerSettings(change: Partial<PlayerSettings>) {
  write(KEY, { ...loadPlayerSettings(), ...change })
}

const BAR_HEIGHT = 36

// YouTube: its player-only page, where the wait it puts before a video when ads are blocked
// doesn't happen. video-forward.html opens it: that page refuses to play without knowing the
// address it was opened from. Twitch: its normal page.
function playerAddress(video: PlayableVideo) {
  if (video.platform !== 'youtube') return video.url
  return `video-forward.html?v=${encodeURIComponent(video.id.slice('youtube-'.length))}`
}

// What the bar shows (public/video-bar.html): it has its own storage and no access to the app's
// translations or colors, so it gets them in its address.
function barData(video: PlayableVideo) {
  const css = getComputedStyle(document.documentElement)
  const colors = Object.fromEntries(
    ['--bg', '--hover', '--text', '--text-dim', '--text-green', '--text-blue'].map((name) => [name, css.getPropertyValue(name).trim()]),
  )
  const data = {
    title: video.title,
    watched: video.watched,
    onTop: loadPlayerSettings().alwaysOnTop,
    zoom: currentZoom(),
    colors,
    labels: {
      watch: t('Mark as watched'),
      unwatch: t('Back to To watch'),
      onTop: t('Always on top'),
      browser: t('Open in browser'),
      minimize: t('Minimize'),
      maximize: t('Maximize'),
      restore: t('Restore'),
      close: t('Close'),
    },
  }
  return encodeURIComponent(JSON.stringify(data))
}

let current: PlayableVideo | null = null
let stopWatching = () => {}

// The bar's clicks that need the app. Listens from the first video on.
let listening = false
function listenToBar() {
  if (listening) return
  listening = true
  void listen<{ action: string; on?: boolean }>('video-bar', ({ payload: { action, on } }) => {
    if (action === 'always-on-top') savePlayerSettings({ alwaysOnTop: !!on })
    if (!current) return
    if (action === 'watched') {
      void setWatched(current.id, !!on)
      if (on && loadPlayerSettings().watchedCloses) void invoke('close_video_player')
    }
    if (action === 'browser') {
      openLink(current.url)
      void invoke('close_video_player') // so you don't hear it twice
    }
  })
}

// Clicks one after the other, so two quick ones can't both create the window
let queue = Promise.resolve()

export function playVideo(video: PlayableVideo) {
  if (!isTauri()) {
    openLink(video.url)
    return
  }
  listenToBar()
  queue = queue
    .then(async () => {
      current = video
      stopWatching()
      await invoke<void>('open_video_player', {
        address: playerAddress(video),
        title: video.title,
        bar: barData(video),
        barHeight: BAR_HEIGHT * currentZoom(),
        alwaysOnTop: loadPlayerSettings().alwaysOnTop,
      })
      // Also when it's ticked in the list while the window is open
      stopWatching = watchWatched(video.id, (watched) => void invoke('video_player_watched', { watched }))
    })
    .catch((error) => {
      console.error('Video player failed', error)
      openLink(video.url) // still gets to watch it
    })
}
