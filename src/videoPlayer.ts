import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { animationsOn } from './animations'
import { currentZoom } from './appearance'
import { locale, t } from './i18n'
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

// The ways to open a video, tried in this order. YouTube: the last one is our message with an
// Open in browser button (the full YouTube page isn't one: it has ads and a long wait as long as
// the window has no extensions). The two sites use YouTube's same player page, so they only help
// when YouTube turns down how we open it, and they see what's watched. Twitch: our own player
// (src-tauri/player), then Twitch's page.
const YOUTUBE_WAYS = ['own', 'yout-ube.com', 'muitube.com', 'stopped'] as const // i18n-ok
const TWITCH_WAYS = ['own', 'twitch.tv'] as const // i18n-ok
type Way = (typeof YOUTUBE_WAYS)[number] | (typeof TWITCH_WAYS)[number]
const OTHER_SITES: Way[] = ['yout-ube.com', 'muitube.com', 'twitch.tv'] // i18n-ok

// Which way worked for a video, on this PC. Only the other sites: our own way is the default, and
// after a stop it's tried again, as the video may be back by then.
const WAYS_KEY = 'syncr.videoWays'
const KEPT_WAYS = 200
function rememberedWay(video: PlayableVideo): Way {
  return read<Record<string, Way>>(WAYS_KEY, {})[video.id] || 'own'
}
function rememberWay(video: PlayableVideo, way: Way) {
  const ways = read<Record<string, Way>>(WAYS_KEY, {})
  delete ways[video.id] // also puts it back as the newest
  if (OTHER_SITES.includes(way)) ways[video.id] = way
  write(WAYS_KEY, Object.fromEntries(Object.entries(ways).slice(-KEPT_WAYS)))
}

function pageColors(names: string[]) {
  const css = getComputedStyle(document.documentElement)
  return Object.fromEntries(names.map((name) => [name, css.getPropertyValue(name).trim()]))
}

// What the own Twitch player shows. Like the bar, it has its own storage and no access to the
// app's translations or colors.
function twitchPlayerAddress(video: PlayableVideo) {
  const data = {
    locale: locale(),
    zoom: currentZoom(),
    animations: animationsOn(),
    colors: pageColors(['--bg', '--hover', '--text', '--text-dim', '--text-blue', '--accent']),
    labels: {
      play: t('Play video'),
      pause: t('Pause'),
      back: t('Back {seconds} s', { seconds: 10 }),
      forward: t('Forward {seconds} s', { seconds: 10 }),
      mute: t('Mute'),
      unmute: t('Unmute'),
      volume: t('Volume'),
      settings: t('Settings'),
      quality: t('Quality'),
      speed: t('Speed'),
      auto: t('Auto'),
      fullscreen: t('Full screen'),
      exitFullscreen: t('Exit full screen'),
      stoppedLoading: t('The video stopped loading'),
      retry: t('Try again'),
      chatShow: t('Show chat'),
      chatHide: t('Hide chat'),
      chatNoRoom: t("Chat can't show here"),
      chatLoading: t('Loading chat…'),
      chatEmpty: t('No chat messages here'),
      chatFailed: t("Couldn't load the chat, trying again…"),
      chatLatest: t('Back to latest'),
      chatTitle: t('Chat'),
      chatHideBots: t('Hide bots and !commands'),
      chatBotNames: t('More bot names, separated by spaces'),
      chatTimes: t('Message times'),
      chatFullTitle: t('Chat in full screen'),
      chatRight: t('Full height, right'),
      chatLeft: t('Full height, left'),
      chatCornerRight: t('Corner, right'),
      chatCornerLeft: t('Corner, left'),
    },
  }
  const id = encodeURIComponent(video.id.slice('twitch-'.length))
  return `https://syncr-video.localhost/player.html?video=${id}&data=${encodeURIComponent(JSON.stringify(data))}`
}

// YouTube: its player-only page, where the wait it puts before a video when ads are blocked
// doesn't happen. video-forward.html opens it: that page refuses to play without knowing the
// address it was opened from.
function playerAddress(video: PlayableVideo, way: Way) {
  if (video.platform === 'twitch') return way === 'own' ? twitchPlayerAddress(video) : video.url
  const id = encodeURIComponent(video.id.slice('youtube-'.length))
  if (way === 'yout-ube.com') return `https://www.yout-ube.com/watch?v=${id}`
  if (way === 'muitube.com') return `https://www.muitube.com/watch?v=${id}`
  if (way === 'own') return `video-forward.html?v=${id}`
  const data = {
    message: t("This video can't play in the player window"),
    browser: t('Open in browser'),
    zoom: currentZoom(),
    colors: pageColors(['--bg', '--text', '--accent']),
  }
  return `video-stopped.html?data=${encodeURIComponent(JSON.stringify(data))}`
}

const viaText = (way: Way) => (OTHER_SITES.includes(way) ? t('via {site}', { site: way }) : '')

// What the bar shows (public/video-bar.html): it has its own storage and no access to the app's
// translations or colors, so it gets them in its address.
function barData(video: PlayableVideo, way: Way) {
  const colors = pageColors(['--bg', '--hover', '--text', '--text-dim', '--text-green', '--text-blue'])
  const data = {
    title: video.title,
    via: viaText(way),
    watched: video.watched,
    onTop: loadPlayerSettings().alwaysOnTop,
    zoom: currentZoom(),
    colors,
    labels: {
      watch: t('Mark as watched'),
      unwatch: t('Back to To watch'),
      onTop: t('Always on top'),
      browser: t('Open in browser'),
      anotherWay: t('Try another way'),
      minimize: t('Minimize'),
      maximize: t('Maximize'),
      restore: t('Restore'),
      close: t('Close'),
    },
  }
  return encodeURIComponent(JSON.stringify(data))
}

let current: PlayableVideo | null = null
let currentWay: Way = 'own'
// Clicks one after the other, so two quick ones can't both create the window
let queue = Promise.resolve()
let stopWatching = () => {}

function changeWay(video: PlayableVideo, way: Way) {
  queue = queue
    .then(async () => {
      if (current !== video) return // another video was opened in the meantime
      currentWay = way
      rememberWay(video, way)
      await invoke<void>('video_player_way', { address: playerAddress(video, way), via: viaText(way) })
    })
    .catch((error) => console.error('Video player failed', error))
}

// The next way, and from the last one back to the first
function nextWay(video: PlayableVideo, way: Way): Way {
  const ways: readonly Way[] = video.platform === 'twitch' ? TWITCH_WAYS : YOUTUBE_WAYS
  return ways[(ways.indexOf(way) + 1) % ways.length]
}

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
    if (action === 'another-way') changeWay(current, nextWay(current, currentWay))
  })
  void listen<{ request?: string; code?: string; video?: string }>('video-site', ({ payload: { request, code, video } }) => {
    // The button on our message (video-stopped.html). A site could fake this signal, so it only
    // counts while that message shows.
    if (request === '/browser') {
      if (!current || currentWay !== 'stopped') return
      openLink(current.url)
      void invoke('close_video_player')
      return
    }
    // Our own Twitch player can't play it (player.js)
    if (request === '/failed') {
      if (current?.id === `twitch-${video}` && currentWay === 'own') changeWay(current, nextWay(current, currentWay))
      return
    }
    // YouTube showed an error (video-watch.js). "auth": the owner doesn't allow playing outside
    // YouTube, or the video is gone or private: the two sites would get the same answer.
    if (!current || current.id !== `youtube-${video}` || currentWay === 'stopped') return
    changeWay(current, code === 'auth' ? 'stopped' : nextWay(current, currentWay))
  })
}

export function playVideo(video: PlayableVideo) {
  if (!isTauri()) {
    openLink(video.url)
    return
  }
  listenToBar()
  queue = queue
    .then(async () => {
      current = video
      currentWay = rememberedWay(video)
      stopWatching()
      await invoke<void>('open_video_player', {
        address: playerAddress(video, currentWay),
        title: video.title,
        bar: barData(video, currentWay),
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
