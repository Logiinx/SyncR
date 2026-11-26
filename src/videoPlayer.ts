import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Window } from '@tauri-apps/api/window'
import { animationsOn } from './animations'
import { currentZoom } from './appearance'
import { locale, t } from './i18n'
import { openLink } from './links'
import { read, write } from './localState'
import { addOrFindVideo, channelKey, followOfChannel, loadFollowsNow, markOpened, setFollowStartSkip, setWatched, watchWatched } from './video'
import { askNextPart, knownNextPart, PART_GAP } from './videoParts'
import { nextInPlaylist } from './videoPlaylists'
import { nearlyDone, resumePosition, savePosition, videoClock } from './videoPositions'
import { leaveQueue, queueOpened, queueStarted } from './videoQueue'

// The video player window (desktop only; video_window.rs, open_video_player). In a browser, videos just
// open in a new tab.
export interface PlayableVideo {
  id: string
  platform: 'youtube' | 'twitch'
  title: string
  channelId: string
  url: string
  thumbnail?: string | null // shown by the player's ⏭ for the video that comes next
  channel?: string // its channel's name and picture, when the list knows them (the full-screen header)
  channelIcon?: string | null
  watched: boolean
  duration: number // 0 when unknown
  live?: boolean // a Twitch stream still live: its length grows
  music?: boolean // a music channel's: never marked as watched by itself (Music is cleared by hand)
}

// A video after the open one in the list it was opened from; playlistId: one of a playlist's
// (Started mixes them in), which then plays in that playlist
export interface UpNext {
  video: PlayableVideo
  playlistId?: string
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
  endCloses: boolean // the window closes when its video ends and no next one plays
  autoNext: 'off' | 'playlists' | 'always' // at its end, the next video plays: never, in a playlist, always
  watchedNearEnd: boolean // near its end, a video moves to Watched by itself
  quality: (typeof YOUTUBE_QUALITIES)[number][0]
  subtitleLanguage: (typeof SUBTITLE_LANGUAGES)[number][0]
  copiedLink: 'queue' | 'play' // a copied video (Ctrl+V in the tab, the global shortcut): added to the Queue or played at once
}
const KEY = 'syncr.videoPlayer'
export const loadPlayerSettings = (): PlayerSettings => ({
  alwaysOnTop: false,
  watchedCloses: false,
  endCloses: true,
  autoNext: 'playlists',
  watchedNearEnd: true,
  copiedLink: 'queue',
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

// The compressor's choice per channel (Twitch and YouTube), on this PC: a channel never set gets
// strength 1 (Light); turned off, it keeps its strength for the A key. Changed in the player
// (controls.js). Saved before the 1–7 steps: Light, Medium, Strong = 1, 3, 6 (the same sound).
// Custom's numbers stay saved when another strength is picked, for the next time it's picked.
// "Use on every channel" (COMPRESSOR_EVERY_KEY): while set, every channel uses that one choice
// instead of its own; each channel's own stays saved and comes back once it's unset.
const COMPRESSOR_KEY = 'syncr.videoCompressor'
const COMPRESSOR_EVERY_KEY = 'syncr.videoCompressorEvery'
const STRENGTHS = ['1', '2', '3', '4', '5', '6', '7', 'peaks', 'voice', 'custom'] // i18n-ok
const OLD_STRENGTHS: Record<string, string> = { light: '1', medium: '3', strong: '6' } // i18n-ok
interface CustomCompressor {
  quiet: number // quiet talk up, 0 to 15 dB
  loud: number // loud parts down, 0 to 15 dB
  voice: boolean // clearer voices
}
interface CompressorChoice {
  on: boolean
  strength: string
  custom?: CustomCompressor
}
const customNumber = (value: unknown) => (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 15 ? (value as number) : null)
function validCustom(custom: CustomCompressor | undefined): CustomCompressor | undefined {
  const quiet = customNumber(custom?.quiet)
  const loud = customNumber(custom?.loud)
  return quiet !== null && loud !== null ? { quiet, loud, voice: custom?.voice === true } : undefined
}
function cleanChoice(saved: CompressorChoice | undefined | null): CompressorChoice {
  if (!saved) return { on: true, strength: '1' }
  const custom = validCustom(saved.custom)
  let strength = OLD_STRENGTHS[saved.strength] ?? saved.strength
  if (!STRENGTHS.includes(strength) || (strength === 'custom' && !custom)) strength = '1'
  return { on: saved.on === true, strength, ...(custom ? { custom } : {}) }
}
// For the player: the choice to use, plus while "every channel" is set (every) the channel's own
// (own), which the player goes back to when it's unset
function compressorData(video: PlayableVideo): (CompressorChoice & { every?: true; own?: CompressorChoice }) | null {
  if (!video.channelId) return null // nothing to remember it for: off
  const own = cleanChoice(read<Record<string, CompressorChoice>>(COMPRESSOR_KEY, {})[channelKey(video)])
  const every = read<CompressorChoice | null>(COMPRESSOR_EVERY_KEY, null)
  return every ? { ...cleanChoice(every), every: true, own } : own
}
// strength: a strength's name, or Custom with its numbers as "custom-7-9-1" (quiet, loud, voice).
// every: saved as every channel's choice; otherwise for this channel, and "every channel" unset.
function saveCompressor(video: PlayableVideo, on: boolean, strength: string, every: boolean) {
  if (!video.channelId) return
  const all = read<Record<string, CompressorChoice>>(COMPRESSOR_KEY, {})
  const key = channelKey(video)
  const before = every ? read<CompressorChoice | null>(COMPRESSOR_EVERY_KEY, null) : all[key]
  const given = /^custom-(\d+)-(\d+)-([01])$/.exec(strength)
  const custom = given ? validCustom({ quiet: Number(given[1]), loud: Number(given[2]), voice: given[3] === '1' }) : validCustom(before?.custom ?? all[key]?.custom)
  if (given ? !custom : !STRENGTHS.includes(strength) || strength === 'custom') return
  const choice = { on, strength: given ? 'custom' : strength, ...(custom ? { custom } : {}) }
  if (every) return write(COMPRESSOR_EVERY_KEY, choice)
  write(COMPRESSOR_EVERY_KEY, null)
  write(COMPRESSOR_KEY, { ...all, [key]: choice })
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
    next: shownNext, // what the ⏭ button plays (controls.js), or null: grayed
    locale: locale(),
    zoom: currentZoom(),
    animations: animationsOn(),
    colors: pageColors(['--bg', '--bg-sunken', '--border', '--hover', '--text', '--text-dim', '--text-blue', '--text-orange', '--text-red', '--text-green', '--text-purple', '--accent']),
    labels: {
      play: t('Play video'),
      pause: t('Pause'),
      back: t('Back {seconds} s', { seconds: 5 }),
      forward: t('Forward {seconds} s', { seconds: 5 }),
      mute: t('Mute'),
      unmute: t('Unmute'),
      volume: t('Volume'),
      settings: t('Settings'),
      quality: t('Quality'),
      speed: t('Speed'),
      normal: t('Normal'),
      compressor: t('Compressor'),
      // Beside "Strength", to read the numbers under each choice
      compressorScale: t('10 dB ≈ twice as loud or quiet'),
      // Under each strength in ⚙️ → Compressor: the numbers ({quiet}, {loud}: "+4", "−10"), then
      // when to use it (each short enough for one row)
      compressorAsIs: t('The sound as it is'),
      compressorDetail: t('Quiet talk {quiet} dB · loud parts {loud} dB'),
      // Under the switch while no step is ticked or hovered
      compressorUntouched: t('Original, untouched sound'),
      compressorStrength: t('Strength|compressor'),
      compressorAdvice: {
        1: t('Barely noticeable: fine for any video'),
        2: t('Calm streams with a few loud moments'),
        3: t('Most streams: talk with some shouting'),
        4: t('Games with loud action and quiet talk'),
        5: t('Uneven sound · a bit more background noise'),
        6: t('Very uneven sound · more background noise'),
        7: t('Low volume, at night · most background noise'),
        peaks: t('Talk untouched: only shouts and bangs go down'),
        voice: t('Like {level}, clearer voices · less bass and hum'),
        custom: t('Your own levels, set with the sliders'),
      },
      // Custom's second row when its numbers make normal talk louder ({talk}: "+7")
      compressorTalk: t('Your own levels · normal talk {talk} dB'),
      compressorQuietUp: t('Quiet talk up'),
      compressorLoudDown: t('Loud parts down'),
      compressorDb: t('{value} dB'),
      compressorClearer: t('Clearer voices'),
      compressorEvery: t('Use on every channel'),
      compressorEveryOff: t('Each channel keeps its own choice'),
      compressorEveryOn: t("Each channel's own choice comes back when unticked"),
      compressorLevel: t('Compressor: {level}'),
      compressorOff: t('Compressor off'),
      // The steps with a name (the others show their number only), then the ones beside them
      strengths: { 1: t('Light|compressor'), 3: t('Medium|compressor'), 6: t('Strong|compressor'), 7: t('Night|compressor'), peaks: t('Peaks only|compressor'), voice: t('Voice|compressor'), custom: t('Custom|compressor') },
      off: t('Off|compressor'),
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
      keepCentered: t('Keep centered'),
      resetPosition: t('Reset position'),
      chapters: t('Chapters'),
      copyLink: t('Copy link'),
      copyLinkAt: t('Copy link at {time}'),
      linkCopied: t('Link copied'),
      linkNotCopied: t("Couldn't copy the link"),
      dragSubtitles: t('Drag the subtitles to move them'),
      stoppedLoading: t('The video stopped loading'),
      retry: t('Try again'),
      nextUp: t('Next|video'),
      noNext: t('No next video'),
      startSkip: t('Skip the waiting screen'),
      startBack: t('Back to the waiting screen'),
      rememberStart: t('Remember as waiting screen'),
      startRemembered: t('Waiting screen remembered'),
      rememberFollowed: t('Only for followed channels'),
      rememberMusic: t('Not for music videos'),
      rememberLive: t('Not while it’s live'),
      rememberLate: t('Only in the first 30 minutes'),
      rememberNoPicturesYet: t('No preview pictures from YouTube yet'), // a past live, for some hours (video-watch.js)
      rememberNoPictures: t('No preview pictures for this video'),
      close: t('Close'),
      // ⚙️ → Keyboard shortcuts (controls.js)
      shortcuts: t('Keyboard shortcuts'),
      keyboard: t('Keyboard'),
      mouse: t('Mouse'),
      keySpace: t('Space|key'),
      keyShift: t('Shift|key'),
      keyEscape: t('Esc|key'),
      wheel: t('Wheel|mouse'),
      wheelOnBar: t('On the bar: −{seconds} s or +{seconds} s', { seconds: 10 }), // WHEEL_JUMP in controls.js
      doubleClick: t('Double-click'),
      playPause: t('Play or pause'),
      muteToggle: t('Mute or unmute'),
      nextVideo: t('Next video'),
      jumpTenths: t('Jump to 0%–90% of the video'),
      closeMenu: t('Close the menu'),
      // ⚙️ → Miscellaneous: Twitch's Game changes (timeline.js), YouTube's Most replayed (video-watch.js)
      miscTitle: t('Miscellaneous'),
      barTitle: t('Progress bar'),
      mostReplayed: t('Most replayed'),
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

// The waiting screen's search at the start (src-tauri/player/startSkip.js, skipShow): off for music
// videos (DECISIONS.md "VOD start skip"); its channel's switch and learned look, if followed
function startSkipData(video: PlayableVideo) {
  const follow = followOfChannel(video)
  return { off: Boolean(video.music || follow?.music), followed: !!follow, auto: !!follow?.autoSkip, looks: follow?.startLooks ?? [] }
}

// The players' header in full screen (controls.js): the follow's name and picture, or what the
// list knows. The Twitch player asks Twitch for what's missing, YouTube's page uses its own.
function headerData(video: PlayableVideo) {
  const follow = followOfChannel(video)
  return { channel: follow?.name ?? video.channel ?? '', picture: follow?.icon ?? video.channelIcon ?? null, title: video.title }
}

function twitchPlayerAddress(video: PlayableVideo) {
  const shared = controlsData()
  const data = {
    ...shared,
    startSkip: startSkipData(video),
    header: headerData(video),
    compressor: compressorData(video),
    labels: {
      ...shared.labels,
      skipMuted: t('Skip muted part'),
      // In the bar's tip over a muted part, before its length ("Muted part · 3:30")
      mutedPart: t('Muted part'),
      // The same for a muted part playing with the sound of another quality's copy (green)
      borrowedPart: t('Sound from another quality'),
      // ... and with the sound the app saved ahead on this PC (purple)
      savedPart: t('Sound saved on this PC'),
      soundBack: t('Sound back in {time}'),
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
      infoBorrowed: t('sound from another quality|muted parts'),
      infoSaved: t('saved sound|muted parts'),
      // Why the pieces played muted ({why} = the counts below, joined by commas, each with Twitch's
      // answers in brackets). Pairs: [one, more]
      infoMutedWhy: t('muted parts: {why}'),
      mutedRefused: [t('{n} refused|one muted piece'), t('{n} refused|muted pieces')],
      mutedSlow: [t('{n} too slow|one muted piece'), t('{n} too slow|muted pieces')],
      mutedTimeout: t('timeout|no answer in time'),
      chatSize: t('Size|chat'),
      chatTitle: t('Chat'),
      chatHideBots: t('Hide bots and !commands'),
      chatBotNames: t('More bot names, separated by spaces'),
      chatTimes: t('Message times'),
      chatTiming: t('Timing|chat'),
      chatTimingHint: t('+ shows the chat earlier, − later. Kept for this channel.'),
      chatSeconds: t('{n} s|chat timing'),
      chatEarlier: t('Chat {n} s earlier'),
      chatLater: t('Chat {n} s later'),
      chatWindowTitle: t('In the window'),
      chatBeside: t('Beside|chat in the window'),
      chatOver: t('Over the video'),
      chatSideRight: t('Right|chat side'),
      chatSideLeft: t('Left|chat side'),
      chatFullTitle: t('In full screen'),
      chatFullWindowTitle: t('In full screen and in the window'),
      chatRight: t('Full height, right'),
      chatLeft: t('Full height, left'),
      chatTopRight: t('Top right corner'),
      chatTopLeft: t('Top left corner'),
      chatBottomRight: t('Bottom right corner'),
      chatBottomLeft: t('Bottom left corner'),
      chatCustom: t("Custom: drag the chat's top or edges"),
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
    return `video-forward.html?v=${id}${start ? `&start=${start}` : ''}&quality=${quality}&subtitles=${subtitlesOn(video) ? 1 : 0}&language=${subtitleLanguage}&data=${encodeURIComponent(JSON.stringify({ ...controlsData(), startSkip: startSkipData(video), header: headerData(video), compressor: compressorData(video) }))}`
  }
  const data = {
    message: t("This video can't play in the player window"),
    browser: t('Open in browser'),
    zoom: currentZoom(),
    colors: pageColors(['--bg', '--text', '--accent']),
  }
  return `video-stopped.html?data=${encodeURIComponent(JSON.stringify(data))}`
}

// A game's trailer in our player (TrailerPlayer.tsx): the same page, from the start, no ⏭, no
// waiting screen, subtitles off (they're one click away)
export function trailerAddress(youtubeId: string) {
  const { quality, subtitleLanguage } = loadPlayerSettings()
  const data = { ...controlsData(), next: null, startSkip: { off: true, followed: false, auto: false, looks: [] } }
  return `video-forward.html?v=${encodeURIComponent(youtubeId)}&quality=${quality}&subtitles=0&language=${subtitleLanguage}&data=${encodeURIComponent(JSON.stringify(data))}`
}

const viaText = (way: Way) => (OTHER_SITES.includes(way) ? t('via {site}', { site: way }) : '')

// The time in a pasted link (?t=), for that video's opening only: it wins over where you stopped
let linkStart: { videoId: string; t: number } | null = null
// Where the open video is now (its reports): opened another way, it goes on from there, not from
// the link's time or the start
let playedTo: { videoId: string; t: number } | null = null

// A video marked as Watched starts from the beginning. Seconds, or 0.
function startAt(video: PlayableVideo) {
  if (playedTo?.videoId === video.id) return playedTo.t
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
      watched: t('Watched'),
      watch: t('Mark as watched'),
      unwatch: t('Back to To watch'),
      onTop: t('Always on top'),
      nextScreen: t('Move to the other screen'),
      screenRight: t('Move to the screen on the right'),
      screenLeft: t('Move to the screen on the left'),
      screenUp: t('Move to the screen above'),
      screenDown: t('Move to the screen below'),
      more: t('More'),
      // Its menu (video-menu.html) gets the same address
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
let watchedNow = false // the open video's Watched mark
let undone = false // taken out of Watched during this viewing: it stays out
// The Queue during this viewing (videoQueue.ts): opened by hand, it goes first; by ⏭ or one after
// another, it joins at the top only when not in it yet (user, 2026-11-22). queuedNow: done.
let byHand = false
let queuedNow = false
// A live stream: its end isn't the end (never Watched by itself, the window stays). Our player says
// when it's over, as the list may say live for up to a check after.
let liveNow = false
let playlist: string | null = null // the playlist it plays in: its next one comes from there
// Outside a playlist: the videos after it in the list it was opened from, as they were then
let upNext: UpNext[] = []
let endSeen = false // its end was handled: more reports of it can come
// What the player's ⏭ shows for the open video: the one after it (title and picture), or null
type ShownNext = { title: string; thumbnail: string | null } | null
let shownNext: ShownNext = null
// A Twitch stream's next part (videoParts.ts), once found: ⏭ and its end play it, whatever the
// setting (user). The search runs once per viewing; lastLength: the page's, which grows while live.
let partNext: PlayableVideo | null = null
let partSearch: Promise<'found' | 'none' | 'closed'> | null = null
let lastLength = 0
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
  // The player's ⏭ button or Shift+N (controls.js). A site in the window could send it too: all it
  // can do is play the next video of the list. Not again in the 3 s a new video takes to start, so
  // a double press doesn't skip two.
  void listen('video-next', () => {
    if (Date.now() >= reportsFrom) playNextNow()
  })
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
  // One that names another video is a late one from the last video: dropped. No name (a page that
  // can't tell, or an older video window script) counts for the open video, as before.
  void listen<{ t: number; length: number; video?: string }>('video-position', ({ payload: { t: seconds, length, video } }) => {
    if (!current || Date.now() < reportsFrom || seconds < 0 || seconds > length) return
    if (video && video !== current.id) return
    if (current.duration > 0 && length < current.duration * 0.9) return
    savePosition(current.id, { t: seconds, length, ...(liveNow && { live: true }) })
    lastLength = length
    playedTo = { videoId: current.id, t: Math.floor(seconds) }
    // Once per opening: dragged elsewhere while it plays, it stays there. A watched one played again
    // stays out: the Queue never shows watched videos, it would stay in it unseen
    if (!current.music && !watchedNow && !queuedNow && resumePosition(current.id)) {
      queuedNow = true
      if (byHand) queueOpened(current.id)
      else queueStarted(current.id)
    }
    if (current.platform === 'twitch' && currentWay === 'own' && seconds > 0) forgetFails(current)
    // Not with an unknown length: the report could be an ad's
    if (liveNow) return
    if (current.duration > 0 && !current.music && !watchedNow && !undone && loadPlayerSettings().watchedNearEnd && nearlyDone({ t: seconds, length })) void setWatched(current.id, true)
    // Music is never watched by itself (cleared by hand): played to its end, it's done with the Queue
    if (current.duration > 0 && current.music && nearlyDone({ t: seconds, length })) leaveQueue([current.id])
    if (current.duration > 0 && seconds >= length) playNext()
  })
  // Subtitles turned on or off by hand. The video's own id, as a site could send this too.
  void listen<{ on: boolean; video: string }>('video-subtitles', ({ payload: { on, video } }) => {
    if (current?.id === `youtube-${video}`) saveSubtitles(current, on)
  })
  // The compressor picked by hand (controls.js, video_window.rs /compressor). Only for the open video.
  void listen<{ on: boolean; strength: string; every: boolean; video: string }>('video-compressor', ({ payload: { on, strength, every, video } }) => {
    if (current?.id === video) saveCompressor(current, on, strength, every)
  })
  // Our own Twitch player found something worth saying (player.js). A site could fake this
  // signal, so it only counts for our player's current video.
  // The channel's waiting screen, learned in the player (startSkip.js, video_window.rs /looks). A
  // site could fake it, so it only counts for the open video's channel, and only a followed one.
  void listen<{ video: string; looks: string[] }>('video-start-looks', ({ payload: { video, looks } }) => {
    if (!current || (current.id !== `youtube-${video}` && current.id !== `twitch-${video}`)) return
    const follow = followOfChannel(current)
    // Sent with - and _ for + and / (nothing to unescape in the address)
    if (follow) void setFollowStartSkip(follow.id, { startLooks: looks.map((look) => look.replaceAll('-', '+').replaceAll('_', '/')) })
  })
  void listen<{ code: string; video: string }>('video-note', ({ payload: { code, video } }) => {
    if (!current || current.id !== `twitch-${video}` || currentWay !== 'own') return
    // Over (or never live): its next part may be there already, or come after a restart
    if (code === 'finished') {
      liveNow = false
      void searchPart(current)
      return
    }
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
function startWatching(video: PlayableVideo, playlistId: string | null, after: UpNext[], openedByHand: boolean) {
  current = video
  playedTo = null
  closedAtEnd = null
  endSeen = false
  playlist = playlistId
  upNext = playlistId ? [] : after
  watchedNow = video.watched
  undone = false
  byHand = openedByHand
  queuedNow = false
  liveNow = !!video.live
  partNext = null
  partSearch = null
  lastLength = 0
  reportsFrom = Date.now() + REPORTS_AFTER
  currentWay = rememberedWay(video)
  newWayShown()
  stopWatching()
}

// Also when it's ticked in the list while the window is open
function followWatched(video: PlayableVideo) {
  stopWatching = watchWatched(video.id, (watched) => {
    // Taken out of Watched: it left the Queue then, it can join again
    if (watchedNow && !watched) {
      undone = true
      queuedNow = false
    }
    watchedNow = watched
    void invoke('video_player_watched', { watched })
  })
}

// The open video reached its end. Once, as more reports of its end can come. The next one plays in
// the same window when the setting says so (by default only in a playlist); otherwise, or with none
// after it, the window closes (a setting, on by default). A Twitch stream's next part always plays
// on; one that can still come (a restart) is waited for, up to 10 min (user).
const PART_WAIT = 10 * 60_000
function playNext() {
  const ended = current
  if (!ended || endSeen) return
  endSeen = true
  void (async () => {
    const part = ended.platform === 'twitch' ? await waitForPart(ended) : 'none'
    if (current !== ended || part === 'closed') return
    // It sat at its end a while: the window may have been closed since (no report says so)
    if (ended.platform === 'twitch' && !(await invoke<boolean>('video_player_upcoming', { upcoming: shownNext }).catch(() => false))) return
    if (current !== ended) return
    const { autoNext } = loadPlayerSettings()
    if (part === 'found' || autoNext === 'always' || (autoNext === 'playlists' && playlist)) goNext(ended, true)
    else closeAtEnd(ended)
  })()
}

function waitForPart(video: PlayableVideo): Promise<'found' | 'none' | 'closed'> {
  if (partNext) return Promise.resolve('found')
  return Promise.race([searchPart(video), new Promise<'none'>((done) => setTimeout(() => done('none'), PART_WAIT))])
}

// Looks for the open video's next part: on this device first, then asks Twitch, again each minute
// while one can still come (a restart: up to PART_GAP after its end). Found: ⏭ shows it at once.
const PART_CHECK_EVERY = 60_000
const PART_CHECKS = 40 // a Worker that keeps failing: not forever
// Closing the video window sends nothing back: asked before each new check (in doubt: open)
const VIDEO_WINDOW = 'video-player' // i18n-ok (video_window.rs)
const windowOpen = () => Window.getByLabel(VIDEO_WINDOW).then(Boolean, () => true)
function searchPart(video: PlayableVideo) {
  if (video.platform !== 'twitch') return Promise.resolve('none' as const)
  partSearch ??= (async () => {
    for (let check = 0; check < PART_CHECKS; check++) {
      if (check > 0) {
        await new Promise((done) => setTimeout(done, PART_CHECK_EVERY))
        if (!(await windowOpen())) return 'closed'
      }
      if (current !== video) return 'none'
      const known = await knownNextPart(video, lastLength).catch(() => null)
      const answer = known ? { part: known, end: 0 } : await askNextPart(video, lastLength).catch((error) => console.warn('Next part failed', error))
      if (current !== video) return 'none'
      if (answer?.part) {
        partNext = answer.part
        shownNext = { title: answer.part.title, thumbnail: answer.part.thumbnail }
        const open = await invoke<boolean>('video_player_upcoming', { upcoming: shownNext }).catch(() => true)
        return open ? 'found' : 'closed'
      }
      // Twitch no longer has it, or too long after its end for a restart (a failed ask: tried again)
      if (answer && (answer.end === null || Date.now() > answer.end + PART_GAP)) return 'none'
    }
    return 'none'
  })()
  return partSearch
}

// The ⏭ button: the next video now (the one left keeps its spot, like closing the window)
export function playNextNow() {
  if (current) goNext(current, false)
}

// What plays after the open video: a Twitch stream's next part, its playlist's next, or the first
// of the list's videos after it. After a part, the list goes on.
async function findNext(video: PlayableVideo, playlistId = playlist, list = upNext): Promise<{ next: UpNext; after: UpNext[]; part?: boolean } | null> {
  const part = (video === current && partNext) || (await knownNextPart(video, video === current ? lastLength : 0).catch(() => null))
  if (part) return { next: { video: part }, after: playlistId ? [] : list, part: true }
  if (playlistId) {
    const next = await nextInPlaylist(playlistId, video.id)
    return next ? { next: { video: next, playlistId }, after: [] } : null
  }
  const [next, ...after] = list
  return next ? { next, after } : null
}

// The same for a video about to start, for its ⏭
async function nextToShow(video: PlayableVideo, playlistId: string | null, after: UpNext[]): Promise<ShownNext> {
  const found = await findNext(video, playlistId, playlistId ? [] : after).catch(() => null)
  return found ? { title: found.next.video.title, thumbnail: found.next.video.thumbnail ?? null } : null
}

function goNext(from: PlayableVideo, atEnd: boolean) {
  queue = queue
    .then(async () => {
      const found = await findNext(from)
      if (current !== from) return // another video was opened in the meantime
      if (!found) {
        if (atEnd) closeAtEnd(from)
        return
      }
      const { next: { video: listed, playlistId }, after } = found
      // A part goes in To watch, like a pasted link (its channel's words may not match it), with its real marks
      const next = found.part ? await addOrFindVideo(listed.url).then(({ video }) => ({ ...video, thumbnail: listed.thumbnail }), () => listed) : listed
      if (current !== from) return
      const way = rememberedWay(next)
      shownNext = await nextToShow(next, playlistId ?? null, after)
      // Not the new page's reports for the old video. It becomes the current one once the window
      // has it: if this fails, the window still shows the old one.
      reportsFrom = Date.now() + REPORTS_AFTER
      await invoke<void>('video_player_next', {
        address: playerAddress(next, way),
        video: next.id.slice('youtube-'.length), // only used in place, which is YouTube to YouTube
        start: startAt(next),
        subtitles: subtitlesOn(next),
        inPlace: way === 'own' && currentWay === 'own' && next.platform === 'youtube' && from.platform === 'youtube',
        upcoming: shownNext, // for a page that plays it in place
        startSkip: startSkipData(next), // the same
        compressor: compressorData(next), // the same
        site: next.platform, // the taskbar button's icon
        title: next.title,
        via: viaText(way),
        ...noteFor(next, way),
      })
      startWatching(next, playlistId ?? null, after, false)
      followWatched(next)
      void markOpened(next.id)
    })
    .catch((error) => console.error('Video player failed', error))
}

let closedAtEnd: PlayableVideo | null = null
function closeAtEnd(video: PlayableVideo) {
  if (closedAtEnd === video || !loadPlayerSettings().endCloses) return
  closedAtEnd = video
  void invoke('close_video_player')
}

// playlistId: it plays in that playlist. start: seconds from a pasted link's time. after: the
// videos after it in the list it's opened from (⏭ and, with the setting, its end play them).
export function playVideo(video: PlayableVideo, playlistId?: string, start?: number, after: UpNext[] = []) {
  linkStart = start ? { videoId: video.id, t: Math.floor(start) } : null
  if (!isTauri()) {
    openLink(video.url)
    return
  }
  listenToBar()
  queue = queue
    .then(async () => {
      await loadFollowsNow() // the waiting screen's search needs its channel's (startSkipData)
      startWatching(video, playlistId ?? null, after, true)
      shownNext = await nextToShow(video, playlistId ?? null, after)
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
