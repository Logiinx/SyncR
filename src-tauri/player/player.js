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

// A stream still live (user: catch up on a weeks-long one): Twitch is still recording it, so its
// list has no end yet. hls.js asks for the list again by itself and the video's length grows with
// it; at its end the video waits for more instead of ending (no end card, never "frozen").
let live = false
let liveTold = false // the app was told it's over (or never was live)

// ---- Quality --------------------------------------------------------------------------------
let hls = null
// 'top' (the highest, until one is chosen), 'auto', or a quality's name. Remembered for all videos.
let chosen = localStorage.getItem('player.quality') || 'top'
// Twitch's list gives the measured rate (59.4 for a 60 fps stream): named like Twitch's site does
const levelName = (level) => `${level.height}p${level.frameRate >= 50 ? (level.frameRate >= 58 ? 60 : Math.round(level.frameRate)) : ''}`

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

// The quality picked that isn't fully playing yet (shown on the ⚙️ button until it is), or null.
// Not for Auto: its own changes come and go by themselves.
let switchingTo = null
// Asked again at each piece downloaded or thrown away, rather than waited for: a piece of the
// old quality that was about to play can be thrown away instead. Done once it plays and the
// downloaded piece after it (if any) is in it too, or once hls.js gave up on it (a failed quality).
function stillSwitching() {
  if (switchingTo === null || !hls) return false
  const after = hls.nextLevel // the downloaded piece after the one playing, -1 if none
  const arrived = hls.currentLevel === switchingTo && (after < 0 || after === switchingTo)
  if (arrived || hls.loadLevel !== switchingTo) switchingTo = null
  return switchingTo !== null
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
  // Twitch's own form for a time: ?t=1h2m3s
  link: (at) => `https://www.twitch.tv/videos/${videoId}${at ? `?t=${Math.floor(at / 3600)}h${Math.floor((at % 3600) / 60)}m${at % 60}s` : ''}`,
  paused: () => video.paused || video.ended,
  time: () => video.currentTime,
  duration: () => video.duration || 0,
  live: () => live,
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
  // For the ⚙️ menu's last line (controls.js): the picture's codec, which folder it comes from, and
  // the sound of muted parts when the video has some
  info() {
    const level = hls?.levels[hls.currentLevel]
    const extra = []
    if (level) extra.push(level.url[0]?.includes('/chunked/') ? labels.infoOriginal : labels.infoCopy)
    if (mutedSound) extra.push(mutedSound === 'uncut' ? labels.infoUncut : mutedText())
    return { codec: level?.videoCodec || playingCodec, extra: extra.filter(Boolean) }
  },
  switchingTo: () => (stillSwitching() ? levelName(hls.levels[switchingTo]) : ''),
  setQuality(value) {
    chosen = value
    localStorage.setItem('player.quality', chosen)
    applyQuality()
    switchingTo = chosen === 'auto' || hls.currentLevel < 0 ? null : wantedLevel()?.index ?? null
  },
}

let dayAt = () => '' // the time of day at a moment; timeline.js fills it in
const controls = playerControls({
  root: document,
  box: player,
  surface: video,
  next: data.next,
  header: data.header,
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
    keyHelp: { c: labels.chatTitle }, // its line in ⚙️ → Keyboard shortcuts
    rememberStart: () => rememberStart(), // timeline.js
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
const { $, icon, clock, setHeader, percentText, numbers, wake, flash, loading, drawTime, drawSettings, drawMenu, closeMenu, jumpTo, typing, setGaps, setMarked, markedAt, showPicture, pictureRoom, tipLines, openParts, closeParts, partsOpen, drawPartsList } = controls
// What ⏭ plays changed while this one plays: the stream's next part was found (video_window.rs,
// video_player_upcoming)
window.syncrUpcoming = (shown) => controls.setNext(shown)

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
  const answer = await response.json()
  // An error instead of an answer is a hiccup on Twitch's side, not a missing video: tried again
  if (!answer.data?.video && answer.errors?.length) throw new Error(`Twitch answered ${JSON.stringify(answer.errors).slice(0, 200)}`)
  return answer.data?.video ?? null
}
const TOKEN_QUERY = 'query($id: ID!) { video: videoPlaybackAccessToken(id: $id, params: {platform: "web", playerBackend: "mediaplayer", playerType: "site"}) { value signature } }'

// ---- Videos Twitch refuses (subscribers only) ---------------------------------------------------
// Their files still lie next to their preview pictures, one folder per quality, and can be read.
// "chunked" is the original, which can be above 1080p. Its size is only written inside its first
// file (sourceHeight); older videos have none, so it's taken as 1080p then and corrected once its
// picture shows (measureSource).
const FOLDERS = { '1080p60': 7500000, '1080p30': 5000000, '720p60': 3100000, '720p30': 2000000, '480p30': 1200000, '360p30': 566000, '160p30': 182000 } // bits per second, as Twitch lists them
const bandwidthFor = (height) => Math.round(FOLDERS['1080p60'] * (height / 1080) ** 2)
const OWN_LIST = `${location.origin}/list.m3u8` // never fetched: hls.js gets `list` there (ListLoader)
let list = '' // the video's qualities: Twitch's list (plus the original, withOriginal), or rebuilt
let refused = false // Twitch refused the video: its list was rebuilt from its folders

async function rebuild() {
  const previews = (await askTwitch('query($id: ID!) { video(id: $id) { seekPreviewsURL } }'))?.seekPreviewsURL
  if (!previews) return null // deleted or private
  const address = new URL(previews)
  const parts = address.pathname.split('/')
  const folder = parts[parts.indexOf('storyboards') - 1]
  if (!folder) return null
  // A past stream's list is index-dvr, a highlight's is named after it
  const names = ['index-dvr.m3u8', `highlight-${encodeURIComponent(videoId)}.m3u8`]
  let unreachable = false // a folder that couldn't be asked (network, Twitch's servers), not one that isn't there
  const found = await Promise.all([...Object.keys(FOLDERS), 'chunked'].map(async (quality) => {
    for (const name of names) {
      const url = `${location.origin}/v/${address.host}/${folder}/${quality}/${name}`
      const response = await fetch(url)
      if (response.ok) return { quality, url, text: quality === 'chunked' ? await response.text() : '' }
      if (response.status >= 500 || response.status === 429) unreachable = true
    }
    return null
  }))
  // None found because of a hiccup: tried again (playRebuilt) instead of giving up
  if (unreachable && !found.some(Boolean)) throw new Error('Twitch\'s video folders couldn\'t be reached')
  const lines = ['#EXTM3U']
  const add = (url, height, frameRate, bandwidth, codec) => lines.push(qualityLine(height, frameRate, bandwidth, codec), url)
  const named = found.filter((one) => one && one.quality !== 'chunked')
  const source = found.find((one) => one?.quality === 'chunked')
  // Only when it's above the copies (or it would show twice), and when this PC can play it
  const top = Math.max(0, ...named.map((one) => Number(one.quality.split('p')[0])))
  const { height, codec } = source ? await sourceInfo(source).catch(() => ({ height: 0, codec: '' })) : { height: 0, codec: '' }
  if (source && (codec ? playable(codec) && height > top : top < 1080)) {
    add(source.url, height || 1080, named.some((one) => one.quality.endsWith('p60')) ? 60 : 30, bandwidthFor(height || 1080), codec)
  }
  for (const { quality, url } of named) add(url, Number(quality.split('p')[0]), Number(quality.split('p')[1]), FOLDERS[quality])
  return lines.length > 1 ? lines.join('\n') : null
}

// The original's size and picture format, from its first file. Older videos (.ts) have none.
// asked: that file already being downloaded ({ url, setup }), used if it's the right one.
async function sourceInfo(source, asked) {
  const first = source.text.match(/#EXT-X-MAP:URI="([^"]+)"/)?.[1]
  if (!first) return { height: 0, codec: '' }
  const address = new URL(first, source.url).href
  const early = address === asked?.url ? await asked.setup : null
  const bytes = new Uint8Array(await (early?.ok ? early : await fetch(address)).arrayBuffer())
  const view = new DataView(bytes.buffer)
  // Where a box's content starts, after its size and name
  const find = (name, from = 4) => {
    for (let at = from; at + 4 <= bytes.length; at++) if (String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]) === name) return at + 4
    return -1
  }
  // Each track's header (tkhd) ends with its width and height in 1/65536ths; the sound's are 0
  let height = 0
  for (let at = find('tkhd'); at > 0 && !height; at = find('tkhd', at)) {
    const end = at - 8 + view.getUint32(at - 8)
    if (end - 8 > at && end <= bytes.length) height = Math.round(view.getUint32(end - 4) / 65536)
  }
  // The format as browsers name it (RFC 6381), from its setup: avcC (H.264) or hvcC (HEVC). The
  // 1440p originals are HEVC, which a PC only plays with the right graphics card and Windows parts.
  let codec = ''
  const avc = find('avcC')
  const hevc = find('hvcC')
  if (avc > 0) codec = 'avc1.' + [1, 2, 3].map((i) => bytes[avc + i].toString(16).padStart(2, '0')).join('')
  else if (hevc > 0) {
    const flags = bytes[hevc + 1]
    let compatible = view.getUint32(hevc + 2)
    let reversed = 0
    for (let i = 0; i < 32; i++, compatible >>>= 1) reversed = ((reversed << 1) | (compatible & 1)) >>> 0
    const constraints = [...bytes.subarray(hevc + 6, hevc + 12)]
    while (constraints.length && !constraints[constraints.length - 1]) constraints.pop()
    codec = [find('hev1') > 0 ? 'hev1' : 'hvc1', ['', 'A', 'B', 'C'][flags >> 6] + (flags & 0x1f), reversed.toString(16).toUpperCase(), (flags & 0x20 ? 'H' : 'L') + bytes[hevc + 12], ...constraints.map((one) => one.toString(16).toUpperCase())].join('.')
  } else codec = 'unknown' // AV1 or something else: not offered
  return { height, codec }
}
const playable = (codec) => !!window.MediaSource?.isTypeSupported(`video/mp4; codecs="${codec}"`)
const qualityLine = (height, frameRate, bandwidth, codec) => `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${Math.round(height * 16 / 9)}x${height},FRAME-RATE=${frameRate}${codec ? `,CODECS="${codec},mp4a.40.2"` : ''}`

// Twitch's list stops at 1080p for viewers who aren't signed in, while the original folder can be
// above it (1440p): it's added on top then, if this PC can play it. Only newer videos say its size
// and format (sourceInfo).
async function withOriginal(text) {
  try {
    const lines = text.split('\n')
    const addresses = lines.filter((line) => line.startsWith('/v/'))
    if (!addresses.length || addresses.some((line) => line.includes('/chunked/'))) return text
    const parts = addresses[0].split('/') // /v/<host>/<video's folder>/<quality>/<list>
    const name = parts.at(-1).startsWith('highlight-') ? `highlight-${encodeURIComponent(videoId)}.m3u8` : 'index-dvr.m3u8'
    const url = `${location.origin}${parts.slice(0, -2).join('/')}/chunked/${name}`
    // Its setup file is asked at the same time (~0.3 s sooner): it's always named init-0.mp4 so far
    const guessed = new URL('init-0.mp4', url).href
    const setup = fetch(guessed).catch(() => null)
    const answer = await fetch(url)
    if (!answer.ok) return text
    const { height, codec } = await sourceInfo({ url, text: await answer.text() }, { url: guessed, setup })
    const top = Math.max(0, ...lines.map((line) => Number(line.match(/RESOLUTION=\d+x(\d+)/)?.[1] ?? 0)))
    if (height <= top || !playable(codec)) return text
    const smooth = lines.some((line) => Number(line.match(/FRAME-RATE=([\d.]+)/)?.[1]) >= 50)
    const at = lines.findIndex((line) => line.startsWith('#EXT-X-MEDIA') || line.startsWith('#EXT-X-STREAM-INF'))
    lines.splice(at, 0, qualityLine(height, smooth ? 60 : 30, bandwidthFor(height), codec), url)
    return lines.join('\n')
  } catch (error) {
    console.error(error)
    return text // Twitch's list as it is
  }
}

// Hands hls.js the list above: this page may only read its own address
// A live stream's list holds all of it (~1 MB after 40 hours) and hls.js asks for it every few
// seconds. Far from its end (hours behind), once a minute is enough: the last copy is given again
// in between, so the bar's end still grows.
const FAR_FROM_END = 300 // seconds
const LIST_EVERY = 60000 // ms
const listCopies = new Map() // address → { text, at }

class ListLoader extends Hls.DefaultConfig.loader {
  load(context, config, callbacks) {
    if (context.url === OWN_LIST) return this.answer(context, callbacks, list)
    const copy = listCopies.get(context.url)
    if (copy && live && video.duration - video.currentTime > FAR_FROM_END && performance.now() - copy.at < LIST_EVERY) {
      return this.answer(context, callbacks, copy.text)
    }
    super.load(context, config, {
      ...callbacks,
      onSuccess: (response, stats, loaded, details) => {
        if (typeof response.data === 'string') listCopies.set(context.url, { text: response.data, at: performance.now() })
        callbacks.onSuccess(response, stats, loaded, details)
      },
    })
  }
  answer(context, callbacks, text) {
    const now = performance.now()
    Object.assign(this.stats.loading, { start: now, first: now, end: now })
    this.stats.loaded = this.stats.total = text.length
    queueMicrotask(() => callbacks.onSuccess({ url: context.url, data: text }, this.stats, context, null))
  }
}

// The original's real size, from its first piece's picture setup (each piece knows its quality).
// Not from the picture on screen: right after a switch it can already show the next quality while
// hls.js still names the original, which then got that quality's size.
function measureSource(_, parsed) {
  const level = hls?.levels[parsed.frag.level]
  const size = parsed.tracks.video?.metadata
  if (!level?.url[0]?.includes('/chunked/') || !size?.height || level.height === size.height) return
  level.height = size.height
  level.width = size.width
  drawSettings()
}

// ---- Muted parts with their sound ---------------------------------------------------------------
// For a while after a stream, Twitch still has a muted piece's uncut file: "N.ts" in older videos,
// "N-unmuted.mp4" in newer ones. It deletes them bit by bit, oldest hours first, and each quality on
// its own: so every muted piece is checked by itself, nearest to where you are first. Those with
// their sound load uncut and aren't shown as muted on the bar.
const MUTED_PIECE = /^(.*\/)(\d+)-muted\.(ts|mp4)$/ // video_window.rs names them all "-muted"
const uncutAddress = (url) => url.replace(MUTED_PIECE, (_, folder, number, kind) => `${folder}${number}${kind === 'ts' ? '.ts' : '-unmuted.mp4'}`)
// Twitch's delivery network keeps two copies of each piece, one per way of asking (video_window.rs,
// like_browser): after Twitch deletes the sound, either can still have it while the other refuses
// (2026-11-21: 206 of 450 pieces one way, 303 the other, 402 with both). So both are asked, the way
// that last found sound first: neighbouring pieces mostly sit in the same one.
const WAYS = ['/v/', '/v-plain/']
const wayAddress = (url, way) => uncutAddress(url).replace('/v/', WAYS[way])
const foundWay = new Map() // muted piece → the way that found its sound
let lastWay = 0
const waysFor = (url) => (foundWay.get(url) ?? lastWay) === 0 ? [0, 1] : [1, 0]
const noteWay = (url, way) => {
  foundWay.set(url, way)
  lastWay = way
}
// A failure that may pass (no answer, timeout 408, too many requests 429, Twitch busy 5xx; our
// network failures arrive as 502), unlike a refusal (other 4xx), which is final for that copy
const passing = (status) => !status || status === 408 || status === 429 || status >= 500
const CHECKS_AT_ONCE = 6
// A piece's original sound, after a passing failure (PieceLoader): tried again until this long
// before it plays (pieces load ~30 s ahead), but at least the first and at most the second number
const UNCUT_MARGIN = 5000 // ms
const UNCUT_PATIENCE = [6000, 60000] // ms
const pieceChecks = new Map() // muted piece's address → its check
const uncutPieces = new Set() // the muted pieces whose sound is still there
const playedPieces = new Set() // the muted pieces whose download answered (it outranks their check)
// Muted piece played muted → why: { why: 'refused' (both copies refused) or 'slow' (no answer in
// time, Twitch busy), codes: Twitch's answers, 'timeout' when none came }
const mutedWhy = new Map()
let soundTold = false
let mutedSound = '' // the quality playing has muted parts: 'uncut' (all with their sound) or 'muted'
let playingCodec = '' // as hls.js found it in the pieces (Twitch's copies don't always list it)

// Only whether it's there (/has/: its headers, video_window.rs), never a part of it: Twitch refuses
// parts of pieces only its delivery network still keeps, which play fine whole. Only for the bar:
// playing tries the sound anyway. Both copies refused means gone; a passing failure is asked again
// a little later, and shows as muted meanwhile.
const checkAddress = (url, way) => wayAddress(url, way).replace(/\/v(-plain)?\//, '/has$1/') // the first one: the route (full addresses)
const CHECK_RETRIES = 2
const CHECK_AGAIN_AFTER = 10000 // ms
async function askHas(url) {
  let again = false
  for (const way of waysFor(url)) {
    const status = await fetch(checkAddress(url, way), { cache: 'no-store' }).then((response) => response.status, () => 0)
    if (status >= 200 && status < 300) return { way }
    if (passing(status)) again = true
  }
  return { again }
}
function checkPiece(url, tries = 0) {
  if (!pieceChecks.has(url)) {
    asking.add(url)
    pieceChecks.set(url, askHas(url).then(({ way, again }) => {
      asking.delete(url)
      if (playedPieces.has(url)) return // its download answered meanwhile, which outranks a check
      if (way !== undefined) {
        uncutPieces.add(url)
        soundSeen.set(url, performance.now())
        noteWay(url, way)
      } else if (again) recheckPiece(url, tries)
      else uncutPieces.delete(url) // asked again (recheckAhead): its sound is gone by now
    }))
  }
  return pieceChecks.get(url)
}
function recheckPiece(url, tries) {
  if (tries >= CHECK_RETRIES) return
  asking.add(url)
  setTimeout(() => {
    asking.delete(url)
    if (playedPieces.has(url)) return // its download answered meanwhile, which outranks a check
    pieceChecks.delete(url)
    checkPiece(url, tries + 1).then(drawMutedSoon)
  }, CHECK_AGAIN_AFTER)
}

// Twitch deletes the sound while you watch (2026-11-22), so a "sound there" answer goes stale; the
// download, ~30 s ahead, would only find out one piece at a time (the muted part and its countdown
// growing by a piece again and again). So the pieces coming up are asked again: every minute while
// playing those whose answer is older than that, and all of them (all) as soon as one plays muted
// after all, further ahead so a long part's end is right at once (no countdown jumping up later).
// Only the ones not downloaded yet: a download outranks a check. Not those being asked right now,
// and all of them at most once a minute: a check can keep saying "there" while the download is
// refused, and every muted piece would ask them all again.
const RECHECK_AHEAD = [300, 1200] // seconds of video: every minute, after a stale answer
const RECHECK_AFTER = 60000 // ms
const RECHECK_MARGIN = 5000 // ms: an answer from the last minute's round counts as old (timers drift)
const soundSeen = new Map() // muted piece → when its sound was last found (performance.now())
const asking = new Set() // muted pieces whose check is running or waiting to try again
let allRecheckAt = -Infinity
function recheckAhead(from, all = false) {
  if (all && performance.now() - allRecheckAt < RECHECK_AFTER) all = false
  if (all) allRecheckAt = performance.now()
  const pieces = playingLevel()?.details?.fragments ?? []
  const old = (one) => all || performance.now() - (soundSeen.get(one.url) ?? 0) > RECHECK_AFTER - RECHECK_MARGIN
  const stale = pieces.filter((one) => uncutPieces.has(one.url) && !playedPieces.has(one.url) && !asking.has(one.url) && one.start + one.duration > from && one.start < from + RECHECK_AHEAD[all ? 1 : 0] && old(one))
  if (!stale.length) return
  for (const one of stale) pieceChecks.delete(one.url)
  checkUncut(pieces)
}
setInterval(() => { if (!video.paused) recheckAhead(video.currentTime) }, RECHECK_AFTER)

// When a quality's list loads or it starts playing: all its muted pieces not asked yet, a few at a
// time, the bar redrawn as answers come. Only the quality playing (hls.js reads others' lists too).
let mutedTimer = null
const drawMutedSoon = () => { mutedTimer ??= setTimeout(() => { mutedTimer = null; drawMuted() }, 300) }
function checkUncut(pieces) {
  const queue = pieces.filter((one) => MUTED_PIECE.test(one.url) && !pieceChecks.has(one.url))
  drawMuted()
  if (!queue.length) return
  const now = video.currentTime
  const distance = (one) => (one.start + one.duration < now ? now - one.start - one.duration : Math.max(one.start - now, 0))
  queue.sort((a, b) => distance(a) - distance(b))
  const next = async () => {
    for (let piece = queue.shift(); piece; piece = queue.shift()) {
      if (pieceChecks.has(piece.url) || !piece.url.startsWith(playingFolder())) continue // asked meanwhile, or another quality
      await checkPiece(piece.url)
      drawMutedSoon()
    }
  }
  for (let i = 0; i < CHECKS_AT_ONCE; i++) next()
}

// The quality playing (or about to)
const playingLevel = () => hls?.levels[hls.currentLevel] ?? hls?.levels[hls.loadLevel]
function playingFolder() {
  const list = playingLevel()?.url[0] ?? ''
  return list.slice(0, list.lastIndexOf('/') + 1)
}

// Its muted parts
function drawMuted() {
  const muted = (playingLevel()?.details?.fragments ?? []).filter((one) => MUTED_PIECE.test(one.url))
  const silent = muted.filter((one) => !uncutPieces.has(one.url))
  mutedSound = !muted.length ? '' : silent.length ? 'muted' : 'uncut'
  noteMutedParts(silent, playingLevel()?.details?.totalduration)
  if (silent.length < muted.length && !soundTold) {
    soundTold = true
    tellBar('sound')
  }
}

// The ⚙️ menu's info: why the quality playing's pieces played muted, once some did, with Twitch's
// answers ("muted parts: 2 refused (403), 1 too slow (timeout/502)"). Counts are 1 or more, where
// English and French both use the singular for 1 only. Labels come in pairs: [one, more].
function mutedText() {
  const pieces = (playingLevel()?.details?.fragments ?? []).map((one) => mutedWhy.get(one.url)).filter(Boolean)
  const count = (why, forms) => {
    const these = pieces.filter((one) => one.why === why)
    if (!these.length) return ''
    const codes = [...new Set(these.flatMap((one) => one.codes))].sort().map((code) => (code === 'timeout' ? labels.mutedTimeout : code))
    return `${forms[these.length > 1 ? 1 : 0].replace('{n}', numbers.format(these.length))} (${codes.join('/')})`
  }
  const why = [count('refused', labels.mutedRefused), count('slow', labels.mutedSlow)].filter(Boolean)
  return why.length ? labels.infoMutedWhy.replace('{why}', why.join(', ')) : labels.infoMuted
}

class PieceLoader extends Hls.DefaultConfig.loader {
  constructor(config) {
    super(config)
    this.hlsConfig = config
  }
  // A muted piece always tries its original sound first, whatever its check said: only the download
  // itself is sure (Twitch can delete it while you watch). Its answer corrects the bar. Both copies
  // are asked (WAYS); a refused one is done, one that failed in passing is asked again, with longer
  // pauses, as long as the piece isn't needed yet (UNCUT_MARGIN before it plays, within
  // UNCUT_PATIENCE). Then the muted one plays.
  load(context, config, callbacks) {
    if (!MUTED_PIECE.test(context.url)) return super.load(context, config, callbacks)
    this.stopped = false
    const ahead = context.frag ? ((context.frag.start - video.currentTime) / (video.playbackRate || 1)) * 1000 : 0
    const patience = Math.min(Math.max(ahead - UNCUT_MARGIN, UNCUT_PATIENCE[0]), UNCUT_PATIENCE[1])
    this.tries = { ways: waysFor(context.url), deadline: performance.now() + patience, pause: 1000, codes: new Set() }
    this.round(context, config, callbacks, 0)
  }
  // One round: each copy not refused yet, one after the other
  round(context, config, callbacks, index) {
    const tries = this.tries
    if (index >= tries.ways.length) {
      const left = tries.deadline - performance.now() // the last try at the limit, not before
      if (tries.ways.length && left > 500) {
        this.retry = setTimeout(() => this.round(context, config, callbacks, 0), Math.min(tries.pause, left))
        tries.pause *= 2
        return
      }
      this.heard(context, false, { why: tries.ways.length ? 'slow' : 'refused', codes: [...tries.codes] })
      return super.load(context, config, callbacks)
    }
    const way = tries.ways[index]
    const inner = (this.inner = new Hls.DefaultConfig.loader(this.hlsConfig))
    const failed = (code) => {
      inner.destroy()
      this.inner = null
      if (this.stopped) return
      tries.codes.add(code)
      if (passing(code === 'timeout' ? 0 : code)) return this.round(context, config, callbacks, index + 1)
      tries.ways.splice(index, 1) // refused: that copy is gone
      this.round(context, config, callbacks, index)
    }
    inner.load({ ...context, url: wayAddress(context.url, way) }, config, {
      ...callbacks,
      onSuccess: (response, stats, _, details) => {
        noteWay(context.url, way)
        this.heard(context, true)
        Object.assign(this.stats, stats)
        callbacks.onSuccess(response, this.stats, context, details)
      },
      onError: (error) => failed(error.code),
      onTimeout: () => failed('timeout'),
    })
  }
  heard(context, sound, why) {
    playedPieces.add(context.url)
    if (sound) mutedWhy.delete(context.url)
    else mutedWhy.set(context.url, why)
    pieceChecks.set(context.url, Promise.resolve()) // no check needed any more
    if (sound === uncutPieces.has(context.url)) return
    if (sound) uncutPieces.add(context.url)
    else uncutPieces.delete(context.url)
    drawMutedSoon()
    // Its check said the sound was there, and it's gone: the next pieces' checks are stale too
    if (why?.why === 'refused' && context.frag) recheckAhead(context.frag.start, true)
  }
  abort() {
    this.stopped = true
    clearTimeout(this.retry)
    this.inner?.abort()
    super.abort()
  }
  destroy() {
    this.stopped = true
    clearTimeout(this.retry)
    this.inner?.destroy()
    this.inner = null
    super.destroy()
  }
}

async function playRebuilt() {
  let rebuilt
  try {
    rebuilt = await rebuild()
  } catch (error) {
    console.error(error)
    return failed()
  }
  if (!rebuilt) return giveUp()
  list = rebuilt
  refused = true
  load()
}

let waitingOnline = false
function failed() {
  clearTimeout(calmTimer)
  clearTimeout(retryTimer)
  // Offline (Wi-Fi gone, the PC waking up): nothing to try until it's back, which isn't counted as a try
  if (navigator.onLine === false) {
    loading(true)
    if (!waitingOnline) {
      waitingOnline = true
      window.addEventListener('online', () => {
        waitingOnline = false
        load()
      }, { once: true })
    }
    return
  }
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

// Twitch's list of qualities, or null when Twitch has no access pass for it (deleted or private).
// The first time, the app has asked for it already while the window opened (video_window.rs,
// early_list): 204 = it couldn't, asked here then.
let earlyAsked = false
async function twitchList() {
  if (!earlyAsked) {
    earlyAsked = true
    const early = await fetch(`/early?video=${encodeURIComponent(videoId)}`).catch(() => null)
    if (early?.status === 200 || early?.status === 403) return early
  }
  const token = await askTwitch(TOKEN_QUERY)
  if (!token) return null
  return fetch(`/v/usher.ttvnw.net/vod/${encodeURIComponent(videoId)}.m3u8?nauth=${encodeURIComponent(token.value)}&nauthsig=${encodeURIComponent(token.signature)}&allow_source=true&allow_audio_only=false`)
}

async function load() {
  if (!refused) {
    try {
      const answer = await twitchList()
      if (!answer) return playRebuilt() // deleted or private: retrying won't help
      // Twitch says no (subscribers only): only the first time, later it's an old token
      if (!everPlayed && answer.status >= 400 && answer.status < 500) return playRebuilt()
      if (!answer.ok) throw new Error(`Twitch answered ${answer.status}`)
      list = await withOriginal(await answer.text())
    } catch (error) {
      console.error(error)
      return failed()
    }
  }
  hls?.destroy()
  hls = new Hls({
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
    backBufferLength: 30,
    startPosition: position,
    fragLoadPolicy: loadPolicy(4, 6),
    playlistLoadPolicy: loadPolicy(2, 2),
    // Labels inside the pieces that nothing here reads
    enableID3MetadataCues: false,
    enableEmsgMetadataCues: false,
    enableDateRangeMetadataCues: false,
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
  switchingTo = null
  // A switch picked (switchingTo) ends with a piece downloaded or thrown away, or one starting to play
  const switchChecked = () => { if (switchingTo !== null) drawSettings() }
  hls.on(Hls.Events.FRAG_BUFFERED, switchChecked)
  hls.on(Hls.Events.BUFFER_FLUSHED, switchChecked)
  hls.on(Hls.Events.LEVEL_SWITCHED, () => {
    drawSettings()
    checkUncut(playingLevel()?.details?.fragments ?? [])
  })
  hls.on(Hls.Events.FRAG_PARSING_INIT_SEGMENT, measureSource)
  hls.on(Hls.Events.LEVEL_LOADED, (_, loaded) => {
    checkUncut(loaded.details.fragments)
    const wasLive = live
    live = loaded.details.live
    if (wasLive && !live) streamOver() // timeline.js: Twitch's preview pictures come now
    // Over (or never live): the app may move it to Watched near its end and play on after it
    if (!live && !liveTold) {
      liveTold = true
      tellBar('finished')
    }
  })
  hls.on(Hls.Events.BUFFER_CODECS, (_, tracks) => { playingCodec = tracks.video?.codec || playingCodec })
  hls.on(Hls.Events.ERROR, (_, error) => {
    if (!error.fatal) return
    console.error(error.details, error.response?.code)
    if (error.type === Hls.ErrorTypes.MEDIA_ERROR && Date.now() - recoveredAt > 10000) {
      recoveredAt = Date.now()
      hls.recoverMediaError()
      return
    }
    failed()
  })
  hls.loadSource(OWN_LIST)
  hls.attachMedia(video)
}

// Asks the bar to say something (videoPlayer.ts has the words, in the app's language)
const tellBar = (code) => fetch(`/note?code=${code}&video=${encodeURIComponent(videoId)}`).catch(() => {})

video.addEventListener('playing', () => {
  if (refused && !everPlayed) tellBar('subscriber')
  everPlayed = true
  // A problem again soon after isn't a new problem
  clearTimeout(calmTimer)
  calmTimer = setTimeout(() => { retries = 0 }, 20000)
})

// A picture stuck on the spinner without any error: after a while, start again where it was, as
// for an error. Not while paused, offline (failed waits for the connection) or hidden.
const FROZEN_AFTER = 30000 // ms
let frozenTimer
function watchFrozen() {
  clearTimeout(frozenTimer)
  const at = video.currentTime
  frozenTimer = setTimeout(() => {
    if (!hls || video.paused || video.currentTime !== at) return
    // Caught up with a live stream: waiting for Twitch to record more
    const atLiveEnd = live && video.duration - video.currentTime < 30
    if (document.hidden || navigator.onLine === false || atLiveEnd) return watchFrozen()
    console.error('No picture for 30 s')
    failed()
  }, FROZEN_AFTER)
}
video.addEventListener('waiting', watchFrozen)
video.addEventListener('playing', () => clearTimeout(frozenTimer))

player.focus()
load()
