// The own Twitch player: a past stream in our own page, its video fetched by Rust (video_window.rs,
// player_answer; /v/<host>/<path>), because Twitch's video servers don't let a page read their
// answers. This page can't call the app. Its text and colors come in its address, like the
// bar's (videoPlayer.ts). What it remembers (volume) stays in the player window's own storage.
// Its buttons, bar, menu and keys are the shared ones (controls.js); this file gives them the video.
const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko' // the one Twitch's own website uses
const RETRY_AFTER = [1000, 3000, 8000] // ms

const params = new URLSearchParams(location.search)
const videoId = params.get('video')
const data = JSON.parse(params.get('data') || '{}')
const labels = data.labels || {}
for (const [name, color] of Object.entries(data.colors || {})) document.documentElement.style.setProperty(name, color)
if (data.zoom) document.documentElement.style.zoom = data.zoom
if (data.animations === false) document.documentElement.classList.add('no-animations')
if (data.locale) document.documentElement.lang = data.locale

const player = document.getElementById('player')
const video = document.getElementById('video')
const controlsStyle = document.createElement('style')
controlsStyle.textContent = CONTROLS_CSS
document.head.append(controlsStyle)

const stored = (name, fallback) => {
  const value = Number(localStorage.getItem(name))
  return localStorage.getItem(name) === null || Number.isNaN(value) ? fallback : value
}

// ---- Quality --------------------------------------------------------------------------------
let hls = null
// 'top' (the highest, until one is chosen), 'auto', or a quality's name. Remembered for all videos.
let chosen = localStorage.getItem('player.quality') || 'top'
const levelName = (level) => `${level.height}p${level.frameRate >= 50 ? Math.round(level.frameRate) : ''}`

function pictureLevels() {
  if (!hls) return []
  return hls.levels
    .map((level, index) => ({ index, name: levelName(level), height: level.height, frameRate: level.frameRate || 0 }))
    .filter((level) => level.height > 0)
    .sort((a, b) => b.height - a.height || b.frameRate - a.frameRate)
}

// The chosen quality, or the closest below it on a stream that doesn't have it
function wantedLevel() {
  const levels = pictureLevels()
  const exact = levels.find((one) => one.name === chosen)
  if (exact) return exact
  const [, height, smooth] = chosen.match(/^(\d+)p(\d+)?$/) || []
  if (!height) return levels[0]
  return levels.find((one) => one.height < Number(height) || (one.height === Number(height) && (smooth || one.frameRate < 50))) || levels[levels.length - 1]
}

function applyQuality() {
  if (!hls) return
  if (chosen === 'auto') {
    hls.currentLevel = -1
    return
  }
  const level = wantedLevel()
  if (level) hls.currentLevel = level.index
}

// ---- What the shared controls act on --------------------------------------------------------
// Volume, remembered in the player's own storage
video.volume = Math.min(Math.max(stored('player.volume', 1), 0), 1)
video.muted = stored('player.muted', 0) === 1
video.addEventListener('volumechange', () => {
  localStorage.setItem('player.volume', video.volume)
  localStorage.setItem('player.muted', video.muted ? 1 : 0)
})

const media = {
  element: video,
  paused: () => video.paused || video.ended,
  time: () => video.currentTime,
  duration: () => video.duration || 0,
  bufferedEnd() {
    let end = 0
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= video.currentTime + 1) end = Math.max(end, video.buffered.end(i))
    }
    return end
  },
  play: () => video.play().catch(() => {}),
  pause: () => video.pause(),
  seek: (seconds) => { video.currentTime = seconds },
  volume: () => video.volume,
  muted: () => video.muted,
  setVolume: (level) => { video.volume = level },
  setMuted: (on) => { video.muted = on },
  rate: () => video.playbackRate,
  setRate: (speed) => { video.playbackRate = speed },
  qualities: () => {
    const levels = pictureLevels()
    return levels.length ? [...levels.map((level) => ({ value: level.name, text: level.name })), { value: 'auto', text: labels.auto }] : []
  },
  quality: () => (chosen === 'auto' ? 'auto' : wantedLevel()?.name),
  qualityText() {
    const playing = hls?.levels[hls.currentLevel]
    const name = playing ? levelName(playing) : ''
    return chosen === 'auto' ? (name ? `${labels.auto} (${name})` : labels.auto) : name
  },
  setQuality(value) {
    chosen = value
    localStorage.setItem('player.quality', chosen)
    applyQuality()
  },
}

let dayAt = () => '' // the time of day at a moment; timeline.js fills it in
const controls = playerControls({
  root: document,
  box: player,
  surface: video,
  labels,
  locale: data.locale,
  hooks: {
    fillTip: (seconds) => fillTip(seconds),
    besideTime: (seconds) => dayAt(seconds),
    menu: (row, title, menu) => {
      timelineMenu(row, title)
      chatMenu(menu, row, title)
    },
    keys: { c: () => toggleChat() },
    keepShowing: () => !$('goto').hidden,
    beforeMenu: () => closeGoTo(),
    pictureClick: () => {
      if ($('goto').hidden) return false
      closeGoTo()
      return true
    },
  },
}, media)
// For timeline.js and chat.js
const { $, icon, clock, numbers, wake, flash, loading, drawTime, drawSettings, drawMenu, closeMenu, jumpTo, typing, setGaps, setMarked, showPicture, tipLines } = controls

// ---- The window takes the video's shape (video_window.rs) ------------------------------------------------
let shapeSent = ''
let shapeTimer
function tellShape() {
  clearTimeout(shapeTimer)
  shapeTimer = setTimeout(() => {
    // Dragging the chat's edge: chat.js calls this again after
    if (!video.videoWidth || document.fullscreenElement || document.documentElement.classList.contains('resizing')) return
    const beside = (1 - player.getBoundingClientRect().width / $('stage').getBoundingClientRect().width) * innerWidth * devicePixelRatio
    const shape = `ratio=${(video.videoWidth / video.videoHeight).toFixed(4)}&beside=${Math.round(beside)}`
    if (shape === shapeSent) return
    shapeSent = shape
    fetch(`/fit?${shape}`, { cache: 'no-store' }).catch(() => {})
  }, 200)
}
video.addEventListener('resize', tellShape)
new ResizeObserver(tellShape).observe(player)

// Where it was, as a reload after an error empties the video
let position = Math.max(Number(params.get('t')) || 0, 0)
const notePosition = () => { if (video.duration) position = video.currentTime }
video.addEventListener('seeking', notePosition)
video.addEventListener('timeupdate', notePosition)

// ---- Playing, and what to do when it fails ------------------------------------------------------
let everPlayed = false
let retries = 0
let retryTimer
let calmTimer
let recoveredAt = 0

// Asks the main window for the next way to open this video, the same way as video-watch.js: a
// visit to an address that doesn't exist, which video_window.rs catches. Faking it only changes the way a
// video opens.
function giveUp() {
  location.href = `https://syncr-video.invalid/failed?video=${encodeURIComponent(videoId)}`
}

async function askTwitch() {
  const query = 'query($id: ID!) { videoPlaybackAccessToken(id: $id, params: {platform: "web", playerBackend: "mediaplayer", playerType: "site"}) { value signature } }'
  const response = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { id: videoId } }),
  })
  if (!response.ok) throw new Error(`Twitch answered ${response.status}`)
  return (await response.json()).data?.videoPlaybackAccessToken ?? null
}

function failed() {
  clearTimeout(calmTimer)
  clearTimeout(retryTimer)
  if (retries < RETRY_AFTER.length) {
    loading(true)
    retryTimer = setTimeout(load, RETRY_AFTER[retries++])
    return
  }
  // Before it has played: another way may work. After: probably the network, so it stays here.
  if (!everPlayed) return giveUp()
  loading(false)
  $('message-text').textContent = labels.stoppedLoading
  $('message').hidden = false
}
$('retry').onclick = () => {
  retries = 0
  $('message').hidden = true
  loading(true)
  load()
}
$('retry').textContent = labels.retry

async function load() {
  let token
  try {
    token = await askTwitch()
  } catch (error) {
    console.error(error)
    return failed()
  }
  if (!token) return giveUp() // deleted or private: retrying won't help
  hls?.destroy()
  hls = new Hls({
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
    backBufferLength: 30,
    startPosition: position,
  })
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    const wanted = wantedLevel()
    if (wanted && chosen !== 'auto') hls.startLevel = wanted.index
    applyQuality()
    drawSettings()
    if (!controls.userPaused()) video.play().catch(() => loading(false)) // refused: the big play button shows
  })
  hls.on(Hls.Events.LEVEL_SWITCHED, drawSettings)
  hls.on(Hls.Events.LEVEL_LOADED, (_, loaded) => noteMutedParts(loaded.details.fragments))
  hls.on(Hls.Events.ERROR, (_, error) => {
    if (!error.fatal) return
    console.error(error.details, error.response?.code)
    // Twitch says no (subscribers only, deleted): only the first time, later it's an old token
    const code = error.response?.code
    if (!everPlayed && code >= 400 && code < 500 && error.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR) return giveUp()
    if (error.type === Hls.ErrorTypes.MEDIA_ERROR && Date.now() - recoveredAt > 10000) {
      recoveredAt = Date.now()
      hls.recoverMediaError()
      return
    }
    failed()
  })
  const source = `/v/usher.ttvnw.net/vod/${encodeURIComponent(videoId)}.m3u8?nauth=${encodeURIComponent(token.value)}&nauthsig=${encodeURIComponent(token.signature)}&allow_source=true&allow_audio_only=false`
  hls.loadSource(source)
  hls.attachMedia(video)
}

video.addEventListener('playing', () => {
  everPlayed = true
  // A problem again soon after isn't a new problem
  clearTimeout(calmTimer)
  calmTimer = setTimeout(() => { retries = 0 }, 20000)
})

player.focus()
load()
