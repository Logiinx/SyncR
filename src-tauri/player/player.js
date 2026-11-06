// The own Twitch player: a past stream in our own page, its video fetched by Rust (lib.rs,
// player_answer; /v/<host>/<path>), because Twitch's video servers don't let a page read their
// answers. This page can't call the app. Its text and colors come in its address, like the
// bar's (videoPlayer.ts). What it remembers (volume) stays in the player window's own storage.
const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko' // the one Twitch's own website uses
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
const JUMP = 10 // seconds
const QUIET_AFTER = 2800 // ms without moving the mouse before the controls fade
const RETRY_AFTER = [1000, 3000, 8000] // ms

const ICONS = {
  play: '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>',
  pause: '<rect x="14" y="3" width="5" height="18" rx="1"/><rect x="5" y="3" width="5" height="18" rx="1"/>',
  volumeHigh: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',
  volumeLow: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/>',
  volumeOff: '<path d="M11 4.702a.7.7 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.7.7 0 0 0 11 19.298z"/><path d="m16.5 14.5 5-5"/><path d="m16.5 9.5 5 5"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  minimize: '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
}
const icon = (name) => `<svg viewBox="0 0 24 24">${ICONS[name]}</svg>`
const $ = (id) => document.getElementById(id)

const params = new URLSearchParams(location.search)
const videoId = params.get('video')
const data = JSON.parse(params.get('data') || '{}')
const labels = data.labels || {}
for (const [name, color] of Object.entries(data.colors || {})) document.documentElement.style.setProperty(name, color)
if (data.zoom) document.documentElement.style.zoom = data.zoom
if (data.animations === false) document.documentElement.classList.add('no-animations')
if (data.locale) document.documentElement.lang = data.locale

const player = $('player')
const video = $('video')
const numbers = new Intl.NumberFormat(data.locale || undefined, { maximumFractionDigits: 2 })

// ---- Time -----------------------------------------------------------------------------------
function clock(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor(total / 60) % 60
  const rest = String(total % 60).padStart(2, '0')
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}

let dragging = null // the moment being dragged to, 0 to 1
function drawTime() {
  const length = video.duration || 0
  const shown = dragging !== null ? dragging * length : video.currentTime
  const part = length ? shown / length : 0
  $('played').style.width = `${part * 100}%`
  $('knob').style.left = `${part * 100}%`
  $('time').textContent = `${clock(shown)} / ${clock(length)}`
  let end = 0
  for (let i = 0; i < video.buffered.length; i++) {
    if (video.buffered.start(i) <= video.currentTime + 1) end = Math.max(end, video.buffered.end(i))
  }
  $('buffer').style.width = `${length ? (end / length) * 100 : 0}%`
}

function jumpTo(seconds) {
  if (!video.duration) return
  video.currentTime = Math.min(Math.max(seconds, 0), video.duration - 0.5)
  drawTime()
}

const partAt = (event) => {
  const box = $('progress').getBoundingClientRect()
  return Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1)
}
$('progress').addEventListener('pointermove', (event) => {
  const part = partAt(event)
  $('tip').hidden = !video.duration
  $('tip').textContent = clock(part * video.duration)
  // Stays inside the window near both ends
  const width = $('progress').clientWidth
  const half = $('tip').offsetWidth / 2
  $('tip').style.left = `${Math.min(Math.max(part * width, half), width - half)}px`
  if (dragging !== null) {
    dragging = part
    drawTime()
  }
})
$('progress').addEventListener('pointerleave', () => { if (dragging === null) $('tip').hidden = true })
$('progress').addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !video.duration) return
  $('progress').setPointerCapture(event.pointerId)
  dragging = partAt(event)
  player.classList.add('dragging')
  drawTime()
})
const endDrag = (event, apply) => {
  if (dragging === null) return
  const part = dragging
  dragging = null
  player.classList.remove('dragging')
  if (apply) jumpTo(part * video.duration)
  if (!$('progress').matches(':hover')) $('tip').hidden = true
}
$('progress').addEventListener('pointerup', (event) => endDrag(event, true))
$('progress').addEventListener('pointercancel', (event) => endDrag(event, false))

// ---- Controls that fade -----------------------------------------------------------------------
let quietTimer
const keepShowing = () => player.classList.contains('paused') || dragging !== null || !$('menu').hidden || $('bottom').matches(':hover')
function wake() {
  player.classList.remove('quiet')
  clearTimeout(quietTimer)
  quietTimer = setTimeout(() => {
    if (keepShowing()) wake()
    else player.classList.add('quiet')
  }, QUIET_AFTER)
}
player.addEventListener('pointermove', wake)
player.addEventListener('pointerdown', wake)
document.documentElement.addEventListener('pointerleave', () => {
  if (!keepShowing()) player.classList.add('quiet')
})

let flashTimer
function flash(text) {
  const box = $('flash')
  box.textContent = text
  box.classList.add('show')
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => box.classList.remove('show'), 500)
}

// ---- Buttons ----------------------------------------------------------------------------------
// What the user asked for, as a reload after an error also stops the video
let userPaused = false
function togglePlay() {
  userPaused = !(video.paused || video.ended)
  if (userPaused) video.pause()
  else video.play().catch(() => {})
}

function drawPlay() {
  const paused = video.paused || video.ended
  player.classList.toggle('paused', paused)
  $('play').innerHTML = icon(paused ? 'play' : 'pause')
  $('play').title = paused ? labels.play : labels.pause
  $('big').title = labels.play
  if (paused) wake()
}
video.addEventListener('play', drawPlay)
video.addEventListener('pause', drawPlay)
video.addEventListener('ended', drawPlay)

function loading(on) {
  player.classList.toggle('loading', on)
  $('spinner').hidden = !on
}
video.addEventListener('waiting', () => loading(true))
video.addEventListener('seeking', () => loading(true))
video.addEventListener('playing', () => loading(false))
video.addEventListener('canplay', () => loading(false))
video.addEventListener('seeked', () => { if (video.readyState >= 3) loading(false) })
// Where it was, as a reload after an error empties the video
let position = 0
const notePosition = () => { if (video.duration) position = video.currentTime }
video.addEventListener('seeking', notePosition)
video.addEventListener('timeupdate', () => {
  notePosition()
  drawTime()
})
video.addEventListener('durationchange', drawTime)
video.addEventListener('progress', drawTime)

$('play').onclick = togglePlay
$('big').onclick = togglePlay
$('back').onclick = () => jumpTo(video.currentTime - JUMP)
$('forward').onclick = () => jumpTo(video.currentTime + JUMP)
$('back').title = labels.back
$('forward').title = labels.forward

// A click on the picture: closes the menu if it's open, otherwise play or pause
video.addEventListener('click', () => {
  if (!$('menu').hidden) closeMenu()
  else togglePlay()
})
video.addEventListener('dblclick', toggleFull)
document.addEventListener('contextmenu', (event) => event.preventDefault())
// The keyboard always stays with the page: Space on a clicked button would press it again
document.addEventListener('click', () => {
  if (document.activeElement !== document.body) document.activeElement.blur()
})

// Volume, remembered in the player's own storage
const stored = (name, fallback) => {
  const value = Number(localStorage.getItem(name))
  return localStorage.getItem(name) === null || Number.isNaN(value) ? fallback : value
}
video.volume = Math.min(Math.max(stored('player.volume', 1), 0), 1)
video.muted = stored('player.muted', 0) === 1
function drawVolume() {
  const silent = video.muted || video.volume === 0
  $('mute').innerHTML = icon(silent ? 'volumeOff' : video.volume <= 0.5 ? 'volumeLow' : 'volumeHigh')
  $('mute').title = silent ? labels.unmute : labels.mute
  $('level').value = silent ? 0 : video.volume
  $('level').title = labels.volume
  localStorage.setItem('player.volume', video.volume)
  localStorage.setItem('player.muted', video.muted ? 1 : 0)
}
video.addEventListener('volumechange', drawVolume)
$('mute').onclick = () => {
  if (video.volume === 0) {
    video.volume = 0.5
    video.muted = false
  } else video.muted = !video.muted
}
$('level').addEventListener('input', () => {
  video.volume = Number($('level').value)
  video.muted = false
})

function toggleFull() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  else document.documentElement.requestFullscreen().catch(() => {})
}
function drawFull() {
  const full = !!document.fullscreenElement
  $('full').innerHTML = icon(full ? 'minimize' : 'maximize')
  $('full').title = full ? labels.exitFullscreen : labels.fullscreen
}
document.addEventListener('fullscreenchange', drawFull)
$('full').onclick = toggleFull

// ---- Quality and speed ------------------------------------------------------------------------
let hls = null
let chosen = 'top' // 'top' (the highest, at start), 'auto', or a quality's name
const levelName = (level) => `${level.height}p${level.frameRate >= 50 ? Math.round(level.frameRate) : ''}`
const speedText = (speed) => `${numbers.format(speed)}×`

function pictureLevels() {
  if (!hls) return []
  return hls.levels
    .map((level, index) => ({ index, name: levelName(level), height: level.height, frameRate: level.frameRate || 0 }))
    .filter((level) => level.height > 0)
    .sort((a, b) => b.height - a.height || b.frameRate - a.frameRate)
}

function drawSettings() {
  const levels = pictureLevels()
  const playing = hls?.levels[hls.currentLevel]
  const name = playing ? levelName(playing) : ''
  const quality = chosen === 'auto' ? (name ? `${labels.auto} (${name})` : labels.auto) : name
  const speed = video.playbackRate === 1 ? '' : speedText(video.playbackRate)
  $('settings-text').textContent = [levels.length ? quality : '', speed].filter(Boolean).join(' · ')
  $('settings').title = labels.settings
  if (!$('menu').hidden) drawMenu()
}
video.addEventListener('ratechange', drawSettings)

function applyQuality() {
  if (!hls) return
  const levels = pictureLevels()
  if (chosen === 'auto') {
    hls.currentLevel = -1
    return
  }
  const level = levels.find((one) => one.name === chosen) || levels[0]
  if (level) hls.currentLevel = level.index
}

function drawMenu() {
  const menu = $('menu')
  menu.textContent = ''
  const title = (text) => {
    const line = document.createElement('div')
    line.className = 'menu-title'
    line.textContent = text
    menu.append(line)
  }
  const levels = pictureLevels()
  if (levels.length) {
    title(labels.quality)
    const playing = hls.levels[hls.currentLevel]
    const items = [...levels.map((level) => ({ value: level.name, text: level.name })), { value: 'auto', text: labels.auto }]
    for (const item of items) {
      const on = item.value === chosen || (chosen === 'top' && playing && levelName(playing) === item.value)
      const row = document.createElement('button')
      row.className = `menu-item${on ? ' on' : ''}`
      row.textContent = item.text
      if (on) row.insertAdjacentHTML('beforeend', icon('check'))
      row.onclick = () => {
        chosen = item.value
        applyQuality()
        closeMenu()
        drawSettings()
      }
      menu.append(row)
    }
  }
  title(labels.speed)
  const speeds = document.createElement('div')
  speeds.id = 'speeds'
  for (const speed of SPEEDS) {
    const button = document.createElement('button')
    button.textContent = speedText(speed)
    if (speed === video.playbackRate) button.className = 'on'
    button.onclick = () => { video.playbackRate = speed }
    speeds.append(button)
  }
  menu.append(speeds)
}
function openMenu() {
  $('menu').hidden = false
  $('settings').classList.add('open')
  drawMenu()
  wake()
}
function closeMenu() {
  $('menu').hidden = true
  $('settings').classList.remove('open')
}
$('settings').onclick = () => ($('menu').hidden ? openMenu() : closeMenu())

// ---- Keyboard ---------------------------------------------------------------------------------
function changeVolume(by) {
  video.muted = false
  video.volume = Math.round(Math.min(Math.max(video.volume + by, 0), 1) * 20) / 20
  flash(`${Math.round(video.volume * 100)}%`)
}
const jumpBack = () => { jumpTo(video.currentTime - JUMP); flash(`−${JUMP} s`) }
const jumpForward = () => { jumpTo(video.currentTime + JUMP); flash(`+${JUMP} s`) }
const KEYS = {
  ' ': togglePlay,
  k: togglePlay,
  ArrowLeft: jumpBack,
  j: jumpBack,
  ArrowRight: jumpForward,
  l: jumpForward,
  ArrowUp: () => changeVolume(0.05),
  ArrowDown: () => changeVolume(-0.05),
  m: () => $('mute').click(),
  f: toggleFull,
}
document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.altKey || event.metaKey) return
  // Not held back: the browser leaves full screen on it by itself
  if (event.key === 'Escape') return closeMenu()
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  if (/^[0-9]$/.test(key)) {
    jumpTo((video.duration || 0) * (Number(key) / 10))
    return event.preventDefault()
  }
  const action = KEYS[key]
  if (!action) return
  event.preventDefault()
  if (event.repeat && (key === ' ' || key === 'k' || key === 'm' || key === 'f')) return
  action()
  wake()
})

// ---- Playing, and what to do when it fails ------------------------------------------------------
let everPlayed = false
let retries = 0
let retryTimer
let calmTimer
let recoveredAt = 0

// Asks the main window for the next way to open this video, the same way as video-watch.js: a
// visit to an address that doesn't exist, which lib.rs catches. Faking it only changes the way a
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
    const top = pictureLevels()[0]
    if (top && chosen !== 'auto') hls.startLevel = top.index
    applyQuality()
    drawSettings()
    if (!userPaused) video.play().catch(() => loading(false)) // refused: the big play button shows
  })
  hls.on(Hls.Events.LEVEL_SWITCHED, drawSettings)
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

drawPlay()
drawVolume()
drawFull()
drawTime()
drawSettings()
wake()
player.focus()
load()
