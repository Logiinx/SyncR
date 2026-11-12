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

// At the next piece: what's already downloaded keeps playing. (currentLevel would throw it all
// away and download again, with the spinner in between.)
function applyQuality() {
  if (!hls) return
  if (chosen === 'auto') {
    hls.nextLevel = -1
    return
  }
  const level = wantedLevel()
  if (level) hls.nextLevel = level.index
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
  // The default too: reloading after an error resets the speed to it
  setRate: (speed) => { video.playbackRate = video.defaultPlaybackRate = speed },
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
    besideOnHover: true, // the time of day: only while the time is hovered
    menu: (menu) => {
      chatMenu(menu)
      timelineMenu(menu)
    },
    keys: { c: () => toggleChat() },
    keepShowing: () => !$('goto').hidden || gamesOpen(),
    beforeMenu: () => {
      closeGoTo()
      closeGames()
    },
    pictureClick: () => {
      if ($('goto').hidden && !gamesOpen()) return false
      closeGoTo()
      closeGames()
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

async function askTwitch(query) {
  const response = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { id: videoId } }),
  })
  if (!response.ok) throw new Error(`Twitch answered ${response.status}`)
  return (await response.json()).data?.video ?? null
}
const TOKEN_QUERY = 'query($id: ID!) { video: videoPlaybackAccessToken(id: $id, params: {platform: "web", playerBackend: "mediaplayer", playerType: "site"}) { value signature } }'

// ---- Videos Twitch refuses (subscribers only) ---------------------------------------------------
// Their files still lie next to their preview pictures, one folder per quality, and can be read.
// "chunked" is the original, which can be above 1080p. Its size is only written inside its first
// file (sourceHeight); older videos have none, so it's taken as 1080p then and corrected once its
// picture shows (measureSource).
const FOLDERS = { '1080p60': 7500000, '1080p30': 5000000, '720p60': 3100000, '720p30': 2000000, '480p30': 1200000, '360p30': 566000, '160p30': 182000 } // bits per second, as Twitch lists them
const REBUILT = `${location.origin}/rebuilt.m3u8` // never fetched: the list is written here (listLoader)
let rebuilt = null // the list, once a video has been found this way

async function rebuild() {
  const previews = (await askTwitch('query($id: ID!) { video(id: $id) { seekPreviewsURL } }'))?.seekPreviewsURL
  if (!previews) return null // deleted or private
  const address = new URL(previews)
  const parts = address.pathname.split('/')
  const folder = parts[parts.indexOf('storyboards') - 1]
  if (!folder) return null
  // A past stream's list is index-dvr, a highlight's is named after it
  const names = ['index-dvr.m3u8', `highlight-${encodeURIComponent(videoId)}.m3u8`]
  const found = await Promise.all([...Object.keys(FOLDERS), 'chunked'].map(async (quality) => {
    for (const name of names) {
      const url = `${location.origin}/v/${address.host}/${folder}/${quality}/${name}`
      const response = await fetch(url)
      if (response.ok) return { quality, url, text: quality === 'chunked' ? await response.text() : '' }
    }
    return null
  }))
  const lines = ['#EXTM3U']
  const add = (url, height, frameRate, bandwidth) => lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${Math.round(height * 16 / 9)}x${height},FRAME-RATE=${frameRate}`, url)
  const named = found.filter((one) => one && one.quality !== 'chunked')
  const source = found.find((one) => one?.quality === 'chunked')
  // Only when it's above the copies, or it would show twice
  const top = Math.max(0, ...named.map((one) => Number(one.quality.split('p')[0])))
  const height = source ? await sourceHeight(source).catch(() => 0) : 0
  if (source && (height > top || (!height && top < 1080))) {
    add(source.url, height || 1080, named.some((one) => one.quality.endsWith('p60')) ? 60 : 30, FOLDERS['1080p60'])
  }
  for (const { quality, url } of named) add(url, Number(quality.split('p')[0]), Number(quality.split('p')[1]), FOLDERS[quality])
  return lines.length > 1 ? lines.join('\n') : null
}

// Each track's header (tkhd) ends with its width and height in 1/65536ths; the sound's are 0
async function sourceHeight(source) {
  const first = source.text.match(/#EXT-X-MAP:URI="([^"]+)"/)?.[1]
  if (!first) return 0
  const bytes = new Uint8Array(await (await fetch(new URL(first, source.url))).arrayBuffer())
  const view = new DataView(bytes.buffer)
  for (let at = 4; at + 4 <= bytes.length; at++) {
    if (bytes[at] !== 0x74 || bytes[at + 1] !== 0x6b || bytes[at + 2] !== 0x68 || bytes[at + 3] !== 0x64) continue // "tkhd"
    const end = at - 4 + view.getUint32(at - 4)
    if (end - 8 > at && end <= bytes.length && view.getUint32(end - 4)) return Math.round(view.getUint32(end - 4) / 65536)
  }
  return 0
}

// Hands hls.js the list written above: this page may only read its own address
class ListLoader extends Hls.DefaultConfig.loader {
  load(context, config, callbacks) {
    if (context.url !== REBUILT) return super.load(context, config, callbacks)
    const now = performance.now()
    Object.assign(this.stats.loading, { start: now, first: now, end: now })
    this.stats.loaded = this.stats.total = rebuilt.length
    queueMicrotask(() => callbacks.onSuccess({ url: context.url, data: rebuilt }, this.stats, context, null))
  }
}

// The original's real size, once its picture shows. The first picture can come before hls.js
// says which quality it is.
function measureSource() {
  if (!rebuilt || !hls || !video.videoHeight) return
  if (hls.currentLevel < 0) return hls.once(Hls.Events.LEVEL_SWITCHED, measureSource)
  const level = hls.levels[hls.currentLevel]
  if (!level?.url[0]?.includes('/chunked/') || level.height === video.videoHeight) return
  level.height = video.videoHeight
  level.width = video.videoWidth
  drawSettings()
}
video.addEventListener('resize', measureSource)

// ---- Muted parts with their sound ---------------------------------------------------------------
// For a while after a stream, Twitch still has a muted piece's uncut file: "N.ts" in older videos
// (often gone within a day), "N-unmuted.mp4" in newer ones. It can be gone in one quality and not in
// another, so each quality is checked once, on its first muted piece. Its muted pieces then load
// uncut (muted if one is refused), and the bar shows no muted parts for it.
const MUTED_PIECE = /^(.*\/)(\d+)-muted\.(ts|mp4)$/ // video_window.rs names them all "-muted"
const uncutAddress = (url) => url.replace(MUTED_PIECE, (_, folder, number, kind) => `${folder}${number}${kind === 'ts' ? '.ts' : '-unmuted.mp4'}`)
const folderOf = (url) => url.slice(0, url.lastIndexOf('/') + 1)
const uncutChecks = {} // quality folder → its check
const uncutFolders = new Set() // the folders that have it
let soundTold = false

// On the first muted piece hls.js asks for, or when its list loads (whichever comes first)
function startCheck(url) {
  const folder = folderOf(url)
  uncutChecks[folder] ??= fetch(uncutAddress(url)).then((response) => {
    if (response.ok) uncutFolders.add(folder)
  }, () => {})
  return uncutChecks[folder]
}

async function checkUncut(pieces) {
  const piece = pieces.find((one) => MUTED_PIECE.test(one.url))
  if (piece) await startCheck(piece.url)
  drawMuted()
}

// The muted parts of the quality playing (or about to)
function drawMuted() {
  const level = hls?.levels[hls.currentLevel] ?? hls?.levels[hls.loadLevel]
  const pieces = level?.details?.fragments ?? []
  const uncut = pieces.some((one) => MUTED_PIECE.test(one.url) && uncutFolders.has(folderOf(one.url)))
  noteMutedParts(uncut ? [] : pieces)
  if (uncut && !soundTold) {
    soundTold = true
    tellBar('sound')
  }
}

class PieceLoader extends Hls.DefaultConfig.loader {
  constructor(config) {
    super(config)
    this.hlsConfig = config
  }
  // A muted piece waits for its quality's check
  load(context, config, callbacks) {
    if (!MUTED_PIECE.test(context.url)) return super.load(context, config, callbacks)
    this.stopped = false
    startCheck(context.url).then(() => {
      if (this.stopped) return
      if (uncutFolders.has(folderOf(context.url))) this.loadUncut(context, config, callbacks)
      else super.load(context, config, callbacks)
    })
  }
  loadUncut(context, config, callbacks) {
    const inner = (this.inner = new Hls.DefaultConfig.loader(this.hlsConfig))
    const muted = () => {
      inner.destroy()
      this.inner = null
      super.load(context, config, callbacks)
    }
    inner.load({ ...context, url: uncutAddress(context.url) }, config, {
      ...callbacks,
      onSuccess: (response, stats, _, details) => {
        Object.assign(this.stats, stats)
        callbacks.onSuccess(response, this.stats, context, details)
      },
      onError: muted,
      onTimeout: muted,
    })
  }
  abort() {
    this.stopped = true
    this.inner?.abort()
    super.abort()
  }
  destroy() {
    this.stopped = true
    this.inner?.destroy()
    this.inner = null
    super.destroy()
  }
}

async function playRebuilt() {
  try {
    rebuilt = await rebuild()
  } catch (error) {
    console.error(error)
    return failed()
  }
  if (!rebuilt) return giveUp()
  load()
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

// Rust sends a piece only once it has all of it (up to ~10 MB at the top quality), so its first
// byte can come late: hls.js's usual 10 s limit would drop it and start the same piece again. A
// stuck download is ended by Rust instead (video_window.rs, player_client). The rest is hls.js's own.
const PATIENT = { maxTimeToFirstByteMs: 60000, maxLoadTimeMs: 120000 }
const loadPolicy = (timeouts, errors) => ({
  default: {
    ...PATIENT,
    timeoutRetry: { maxNumRetry: timeouts, retryDelayMs: 0, maxRetryDelayMs: 0 },
    errorRetry: { maxNumRetry: errors, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
  },
})

async function load() {
  let source = REBUILT
  if (!rebuilt) {
    let token
    try {
      token = await askTwitch(TOKEN_QUERY)
    } catch (error) {
      console.error(error)
      return failed()
    }
    if (!token) return playRebuilt() // deleted or private: retrying won't help
    source = `/v/usher.ttvnw.net/vod/${encodeURIComponent(videoId)}.m3u8?nauth=${encodeURIComponent(token.value)}&nauthsig=${encodeURIComponent(token.signature)}&allow_source=true&allow_audio_only=false`
  }
  hls?.destroy()
  hls = new Hls({
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
    backBufferLength: 30,
    startPosition: position,
    fragLoadPolicy: loadPolicy(4, 6),
    playlistLoadPolicy: loadPolicy(2, 2),
    pLoader: ListLoader,
    fLoader: PieceLoader,
  })
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    const wanted = wantedLevel()
    if (wanted && chosen !== 'auto') hls.startLevel = wanted.index
    applyQuality()
    drawSettings()
    if (!controls.userPaused()) video.play().catch(() => loading(false)) // refused: the big play button shows
  })
  hls.on(Hls.Events.LEVEL_SWITCHED, () => {
    drawSettings()
    drawMuted()
  })
  hls.on(Hls.Events.LEVEL_LOADED, (_, loaded) => checkUncut(loaded.details.fragments))
  hls.on(Hls.Events.ERROR, (_, error) => {
    if (!error.fatal) return
    console.error(error.details, error.response?.code)
    // Twitch says no (subscribers only, deleted): only the first time, later it's an old token
    const code = error.response?.code
    if (!everPlayed && code >= 400 && code < 500 && error.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR) return rebuilt ? giveUp() : playRebuilt()
    if (error.type === Hls.ErrorTypes.MEDIA_ERROR && Date.now() - recoveredAt > 10000) {
      recoveredAt = Date.now()
      hls.recoverMediaError()
      return
    }
    failed()
  })
  hls.loadSource(source)
  hls.attachMedia(video)
}

// Asks the bar to say something (videoPlayer.ts has the words, in the app's language)
const tellBar = (code) => fetch(`/note?code=${code}&video=${encodeURIComponent(videoId)}`).catch(() => {})

video.addEventListener('playing', () => {
  if (rebuilt && !everPlayed) tellBar('subscriber')
  everPlayed = true
  // A problem again soon after isn't a new problem
  clearTimeout(calmTimer)
  calmTimer = setTimeout(() => { retries = 0 }, 20000)
})

player.focus()
load()
