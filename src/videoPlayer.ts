import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { animationsOn } from './animations'
import { currentZoom } from './appearance'
import { locale, t } from './i18n'
import { openLink } from './links'
import { read, write } from './localState'
import { markOpened, setWatched, watchWatched } from './video'
import { nextInPlaylist } from './videoPlaylists'
import { nearlyDone, resumePosition, savePosition, videoClock } from './videoPositions'

// The video player window (desktop only; video_window.rs, open_video_player). In a browser, videos just
// open in a new tab.
interface PlayableVideo {
  id: string
  platform: 'youtube' | 'twitch'
  title: string
  channelId: string
  url: string
  watched: boolean
  duration: number // 0 when unknown
}

// YouTube's names for its qualities, as its player wants them (video-watch.js)
export const YOUTUBE_QUALITIES = [
  ['auto', ''], // i18n-ok
  ['hd2160', '2160p'], // i18n-ok
  ['hd1440', '1440p'], // i18n-ok
  ['hd1080', '1080p'], // i18n-ok
  ['hd720', '720p'], // i18n-ok
  ['large', '480p'], // i18n-ok
] as const
// Each in its own language, so it can be found from any other one
export const SUBTITLE_LANGUAGES = [
  ['en', 'English'], // i18n-ok
  ['fr', 'Français'], // i18n-ok
  ['es', 'Español'], // i18n-ok
  ['de', 'Deutsch'], // i18n-ok
  ['it', 'Italiano'], // i18n-ok
  ['pt', 'Português'], // i18n-ok
  ['nl', 'Nederlands'], // i18n-ok
  ['ru', 'Русский'], // i18n-ok
  ['ja', '日本語'], // i18n-ok
  ['ko', '한국어'], // i18n-ok
  ['zh', '中文'], // i18n-ok
] as const

// Per device, like the rest of the Video tab
export interface PlayerSettings {
  alwaysOnTop: boolean
  watchedCloses: boolean // Watched on the bar also closes the window
  watchedNearEnd: boolean // near its end, a video moves to Watched by itself
  quality: (typeof YOUTUBE_QUALITIES)[number][0]
  subtitleLanguage: (typeof SUBTITLE_LANGUAGES)[number][0]
}
const KEY = 'syncr.videoPlayer'
export const loadPlayerSettings = (): PlayerSettings => ({
  alwaysOnTop: false,
  watchedCloses: false,
  watchedNearEnd: true,
  quality: 'hd1440',
  subtitleLanguage: locale().startsWith('fr') ? 'fr' : 'en',
  ...read<Partial<PlayerSettings>>(KEY, {}),
})
export function savePlayerSettings(change: Partial<PlayerSettings>) {
  write(KEY, { ...loadPlayerSettings(), ...change })
}

// The YouTube channels with subtitles on, on this PC; the others have them off. Changed by the
// button in the player (video-watch.js).
const SUBTITLES_KEY = 'syncr.videoSubtitles'
const subtitlesOn = (video: PlayableVideo) => read<string[]>(SUBTITLES_KEY, []).includes(video.channelId)
function saveSubtitles(video: PlayableVideo, on: boolean) {
  const others = read<string[]>(SUBTITLES_KEY, []).filter((channel) => channel !== video.channelId)
  write(SUBTITLES_KEY, on ? [...others, video.channelId] : others)
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

// Our Twitch player giving up once can be a passing problem: Twitch's page is only remembered for a
// video when it gives up twice in a row. Playing in between, or picking a way by hand, starts the count over.
const FAILS_KEY = 'syncr.twitchFails'
function failedTwice(video: PlayableVideo) {
  const fails = read<Record<string, number>>(FAILS_KEY, {})
  const twice = (fails[video.id] ?? 0) >= 1
  delete fails[video.id] // also puts it back as the newest
  if (!twice) fails[video.id] = 1
  write(FAILS_KEY, Object.fromEntries(Object.entries(fails).slice(-KEPT_WAYS)))
  return twice
}
function forgetFails(video: PlayableVideo) {
  const fails = read<Record<string, number>>(FAILS_KEY, {})
  if (!(video.id in fails)) return
  delete fails[video.id]
  write(FAILS_KEY, fails)
}

function pageColors(names: string[]) {
  const css = getComputedStyle(document.documentElement)
  return Object.fromEntries(names.map((name) => [name, css.getPropertyValue(name).trim()]))
}

// What our own players' controls show (src-tauri/player/controls.js), on Twitch and YouTube. Like
// the bar, their pages have their own storage and no access to the app's translations or colors.
function controlsData() {
  return {
    locale: locale(),
    zoom: currentZoom(),
    animations: animationsOn(),
    colors: pageColors(['--bg', '--bg-sunken', '--border', '--hover', '--text', '--text-dim', '--text-blue', '--text-orange', '--accent']),
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
      normal: t('Normal'),
      menuBack: t('Back'),
      auto: t('Auto'),
      fullscreen: t('Full screen'),
      exitFullscreen: t('Exit full screen'),
      subtitles: t('Subtitles'),
      subtitlesShow: t('Show subtitles'),
      subtitlesHide: t('Hide subtitles'),
      noSubtitles: t('No subtitles for this video'),
      subtitlesOff: t('Off|subtitles'),
      autoGenerated: t('{language} (auto-generated)'),
      fps: t('{n} fps'),
      translated: t('{language} (translated)'),
      subtitleSize: t('Size|subtitles'),
      smaller: t('Smaller'),
      bigger: t('Bigger'),
      resetPosition: t('Reset position'),
      chapters: t('Chapters'),
      copyLink: t('Copy link'),
      copyLinkAt: t('Copy link at {time}'),
      linkCopied: t('Link copied'),
      dragSubtitles: t('Drag the subtitles to move them'),
      stoppedLoading: t('The video stopped loading'),
      retry: t('Try again'),
      // SponsorBlock's categories, named in the tip over the bar
      sponsorParts: {
        sponsor: t('Sponsor'),
        selfpromo: t('Self-promotion'),
        interaction: t('Interaction reminder'),
        intro: t('Intro'),
        outro: t('End credits'),
        preview: t('Preview or recap'),
        music_offtopic: t('Non-music part'),
        filler: t('Tangent'),
      },
    },
  }
}

function twitchPlayerAddress(video: PlayableVideo) {
  const shared = controlsData()
  const data = {
    ...shared,
    labels: {
      ...shared.labels,
      skipMuted: t('Skip muted part'),
      barTitle: t('Progress bar'),
      gameChanges: t('Game changes'),
      games: t('Games'),
      goTo: t('Go to a time'),
      goToHint: t('A place in the video, like 1:23:45, then Enter'),
      goToHintDay: t('A time of day like 21:30, or a place in the video like 1:23:45, then Enter'),
      goToWrong: t("That time isn't in this video"),
      chatShow: t('Show chat'),
      chatHide: t('Hide chat'),
      chatNoRoom: t("Chat can't show here"),
      chatLoading: t('Loading chat…'),
      chatEmpty: t('No chat messages here'),
      chatFailed: t("Couldn't load the chat, trying again…"),
      chatLatest: t('Back to latest'),
      // The ⚙️ menu's last line: where the picture comes from, and the sound of muted parts
      infoOriginal: t('original|video source'),
      infoCopy: t('Twitch copy'),
      infoMuted: t('muted parts'),
      infoUncut: t('original sound|muted parts'),
      chatSize: t('Size|chat'),
      chatTitle: t('Chat'),
      chatHideBots: t('Hide bots and !commands'),
      chatBotNames: t('More bot names, separated by spaces'),
      chatTimes: t('Message times'),
      chatFullTitle: t('In full screen'),
      chatRight: t('Full height, right'),
      chatLeft: t('Full height, left'),
      chatCornerRight: t('Corner, right'),
      chatCornerLeft: t('Corner, left'),
      chatBackground: t('Background|chat'),
    },
  }
  const id = encodeURIComponent(video.id.slice('twitch-'.length))
  const start = startAt(video)
  return `https://syncr-video.localhost/player.html?video=${id}${start ? `&t=${start}` : ''}&data=${encodeURIComponent(JSON.stringify(data))}`
}

// YouTube: its player-only page, where the wait it puts before a video when ads are blocked
// doesn't happen. video-forward.html opens it: that page refuses to play without knowing the
// address it was opened from.
function playerAddress(video: PlayableVideo, way: Way) {
  const start = startAt(video)
  if (video.platform === 'twitch') {
    if (way === 'own') return twitchPlayerAddress(video)
    if (!start) return video.url
    const url = new URL(video.url)
    url.searchParams.set('t', `${Math.floor(start / 3600)}h${Math.floor((start % 3600) / 60)}m${start % 60}s`)
    return url.href
  }
  const id = encodeURIComponent(video.id.slice('youtube-'.length))
  if (way === 'yout-ube.com') return `https://www.yout-ube.com/watch?v=${id}${start ? `&t=${start}` : ''}`
  if (way === 'muitube.com') return `https://www.muitube.com/watch?v=${id}` // ignores any start time
  if (way === 'own') {
    const { quality, subtitleLanguage } = loadPlayerSettings()
    return `video-forward.html?v=${id}${start ? `&start=${start}` : ''}&quality=${quality}&subtitles=${subtitlesOn(video) ? 1 : 0}&language=${subtitleLanguage}&data=${encodeURIComponent(JSON.stringify(controlsData()))}`
  }
  const data = {
    message: t("This video can't play in the player window"),
    browser: t('Open in browser'),
    zoom: currentZoom(),
    colors: pageColors(['--bg', '--text', '--accent']),
  }
  return `video-stopped.html?data=${encodeURIComponent(JSON.stringify(data))}`
}

const viaText = (way: Way) => (OTHER_SITES.includes(way) ? t('via {site}', { site: way }) : '')

// The time in a pasted link (?t=), for that video's opening only: it wins over where you stopped
let linkStart: { videoId: string; t: number } | null = null

// A video marked as Watched starts from the beginning. Seconds, or 0.
function startAt(video: PlayableVideo) {
  if (linkStart?.videoId === video.id) return linkStart.t
  return video.watched ? 0 : Math.floor(resumePosition(video.id)?.t ?? 0)
}

// Where it continues, on the bar. muitube.com is the one way that can't be told where to start.
function noteFor(video: PlayableVideo, way: Way) {
  const start = startAt(video)
  if (!start || way === 'stopped') return { note: '', noteStays: false } // i18n-ok
  if (way === 'muitube.com') return { note: t('You can resume by jumping to {time}', { time: videoClock(start) }), noteStays: true } // i18n-ok
  return { note: t('Resumed at {time}', { time: videoClock(start) }), noteStays: false }
}

// What the bar shows (public/video-bar.html): it has its own storage and no access to the app's
// translations or colors, so it gets them in its address.
function barData(video: PlayableVideo, way: Way) {
  const colors = pageColors(['--bg', '--bg-raised', '--border', '--hover', '--text', '--text-dim', '--text-green', '--text-blue'])
  const data = {
    title: video.title,
    via: viaText(way),
    ...noteFor(video, way),
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
      extensions: t('Extensions'),
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
let watchedNow = false // the open video's Watched mark
let undone = false // taken out of Watched during this viewing: it stays out
let playlist: string | null = null // the playlist it plays in: the next one follows at its end
// Not from the page of a video that was just replaced
let reportsFrom = 0
const REPORTS_AFTER = 3000 // ms

// Notes from our own Twitch player (player.js), shown on the bar with the opening's note while it lasts
const BAR_NOTE_FOR = 6000 // ms, as in video-bar.html
let playerNotes: { text: string; at: number }[] = []
let wayShownAt = 0
function newWayShown() {
  playerNotes = []
  wayShownAt = Date.now()
}

// remember: false for this opening only
function changeWay(video: PlayableVideo, way: Way, remember = true) {
  queue = queue
    .then(async () => {
      if (current !== video) return // another video was opened in the meantime
      currentWay = way
      if (remember) rememberWay(video, way)
      newWayShown()
      await invoke<void>('video_player_way', { address: playerAddress(video, way), via: viaText(way), ...noteFor(video, way) })
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
    if (action === 'another-way') {
      forgetFails(current)
      changeWay(current, nextWay(current, currentWay))
    }
  })
  // How far the page's video is (video-watch.js). A report much shorter than the video is an ad.
  void listen<{ t: number; length: number }>('video-position', ({ payload: { t: seconds, length } }) => {
    if (!current || Date.now() < reportsFrom || seconds < 0 || seconds > length) return
    if (current.duration > 0 && length < current.duration * 0.9) return
    savePosition(current.id, { t: seconds, length })
    if (current.platform === 'twitch' && currentWay === 'own' && seconds > 0) forgetFails(current)
    // Not with an unknown length: the report could be an ad's
    if (current.duration > 0 && !watchedNow && !undone && loadPlayerSettings().watchedNearEnd && nearlyDone({ t: seconds, length })) void setWatched(current.id, true)
    if (current.duration > 0 && seconds >= length) playNext()
  })
  // Subtitles turned on or off by hand. The video's own id, as a site could send this too.
  void listen<{ on: boolean; video: string }>('video-subtitles', ({ payload: { on, video } }) => {
    if (current?.id === `youtube-${video}`) saveSubtitles(current, on)
  })
  // Our own Twitch player found something worth saying (player.js). A site could fake this
  // signal, so it only counts for our player's current video.
  void listen<{ code: string; video: string }>('video-note', ({ payload: { code, video } }) => {
    if (!current || current.id !== `twitch-${video}` || currentWay !== 'own') return
    const text = code === 'subscriber' ? t('Subscriber-only video') : code === 'sound' ? t('Original sound') : '' // i18n-ok
    if (!text || playerNotes.some((one) => one.text === text)) return
    const now = Date.now()
    playerNotes.push({ text, at: now })
    const opening = now - wayShownAt < BAR_NOTE_FOR ? noteFor(current, currentWay).note : ''
    const note = [opening, ...playerNotes.filter((one) => now - one.at < BAR_NOTE_FOR).map((one) => one.text)].filter(Boolean).join(' · ')
    void invoke('video_player_note', { via: viaText(currentWay), note }).catch((error) => console.error('Video player failed', error))
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
      if (current?.id === `twitch-${video}` && currentWay === 'own') changeWay(current, nextWay(current, currentWay), failedTwice(current))
      return
    }
    // YouTube showed an error (video-watch.js). "auth": the owner doesn't allow playing outside
    // YouTube, or the video is gone or private: the two sites would get the same answer.
    if (!current || current.id !== `youtube-${video}` || currentWay === 'stopped') return
    changeWay(current, code === 'auth' ? 'stopped' : nextWay(current, currentWay))
  })
}

// What goes with a video starting in the window
function startWatching(video: PlayableVideo, playlistId: string | null) {
  current = video
  playlist = playlistId
  watchedNow = video.watched
  undone = false
  reportsFrom = Date.now() + REPORTS_AFTER
  currentWay = rememberedWay(video)
  newWayShown()
  stopWatching()
}

// Also when it's ticked in the list while the window is open
function followWatched(video: PlayableVideo) {
  stopWatching = watchWatched(video.id, (watched) => {
    if (watchedNow && !watched) undone = true
    watchedNow = watched
    void invoke('video_player_watched', { watched })
  })
}

// The open video reached its end: the next one of its playlist, in the same window. Once, as more
// reports of its end can come. After the last one, it just stays there.
function playNext() {
  const ended = current
  const playlistId = playlist
  if (!ended || !playlistId) return
  playlist = null
  queue = queue
    .then(async () => {
      const next = await nextInPlaylist(playlistId, ended.id)
      if (!next || current !== ended) return // another video was opened in the meantime
      const way = rememberedWay(next)
      // Not the new page's reports for the old video. It becomes the current one once the window
      // has it: if this fails, the window still shows the old one.
      reportsFrom = Date.now() + REPORTS_AFTER
      await invoke<void>('video_player_next', {
        address: playerAddress(next, way),
        video: next.id.slice('youtube-'.length), // playlists are YouTube's
        start: startAt(next),
        subtitles: subtitlesOn(next),
        inPlace: way === 'own' && currentWay === 'own',
        title: next.title,
        via: viaText(way),
        ...noteFor(next, way),
      })
      startWatching(next, playlistId)
      followWatched(next)
      void markOpened(next.id)
    })
    .catch((error) => console.error('Video player failed', error))
}

// playlistId: it plays in that playlist. start: seconds from a pasted link's time.
export function playVideo(video: PlayableVideo, playlistId?: string, start?: number) {
  linkStart = start ? { videoId: video.id, t: Math.floor(start) } : null
  if (!isTauri()) {
    openLink(video.url)
    return
  }
  listenToBar()
  queue = queue
    .then(async () => {
      startWatching(video, playlistId ?? null)
      await invoke<void>('open_video_player', {
        address: playerAddress(video, currentWay),
        title: video.title,
        site: video.platform,
        bar: barData(video, currentWay),
        barHeight: BAR_HEIGHT * currentZoom(),
        alwaysOnTop: loadPlayerSettings().alwaysOnTop,
      })
      followWatched(video)
    })
    .catch((error) => {
      console.error('Video player failed', error)
      openLink(video.url) // still gets to watch it
    })
}
