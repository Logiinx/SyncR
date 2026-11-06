// Player Lab, step 0: can a public past stream play in our own page, with its video fetched by
// Rust (/v/<host>/<path>)? Only a proof: the page and its numbers, no interface yet.
const CLIENT = 'kimne78kx3ncx6brgo4mv6wki5h1ko'
const video = document.getElementById('video')
const params = new URLSearchParams(location.search)
const opened = performance.now()
const lab = (window.__lab = { times: {}, errors: [], fatal: null, levels: [], hlsVersion: Hls.version, supported: Hls.isSupported() })
const mark = (name) => { lab.times[name] ??= Math.round(performance.now() - opened) }

async function gql(query, variables = {}) {
  const response = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Client-ID': CLIENT, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  return response.json()
}

async function start() {
  let id = params.get('video')
  if (!id) {
    const list = await gql(`query($l: String!) { user(login: $l) { videos(first: 20, type: ARCHIVE) { edges { node { id lengthSeconds } } } } }`, { l: params.get('channel') })
    const longest = list.data.user.videos.edges.map((edge) => edge.node).sort((a, b) => b.lengthSeconds - a.lengthSeconds)[0]
    id = longest.id
    lab.length = longest.lengthSeconds
  }
  lab.video = id
  mark('listed')
  const token = (await gql(`query($id: ID!) { videoPlaybackAccessToken(id: $id, params: {platform: "web", playerBackend: "mediaplayer", playerType: "site"}) { value signature } }`, { id })).data.videoPlaybackAccessToken
  mark('token')
  const source = `/v/usher.ttvnw.net/vod/${id}.m3u8?nauth=${encodeURIComponent(token.value)}&nauthsig=${encodeURIComponent(token.signature)}&allow_source=true&allow_audio_only=true`
  const hls = (window.__hls = new Hls({ maxBufferLength: 30, maxMaxBufferLength: 60, backBufferLength: 30 }))
  hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
    mark('playlist')
    lab.levels = data.levels.map((level) => `${level.height}p${Math.round(level.frameRate || 0)}`)
    // The highest with a picture: what the preferred quality setting will do later
    let top = 0
    data.levels.forEach((level, index) => { if (level.height > data.levels[top].height) top = index })
    hls.startLevel = top
    hls.currentLevel = top
    video.play().then(() => { lab.autoplay = 'allowed' }, (error) => { lab.autoplay = `refused: ${error.name}` })
  })
  hls.on(Hls.Events.FRAG_LOADED, () => mark('firstPiece'))
  hls.on(Hls.Events.ERROR, (_, data) => {
    lab.errors.push(`${data.type}/${data.details}${data.fatal ? ' FATAL' : ''}`)
    if (data.fatal) lab.fatal = data.details
  })
  video.addEventListener('playing', () => mark('playing'), { once: true })
  hls.loadSource(source)
  hls.attachMedia(video)
}
start().catch((error) => { lab.fatal = String(error) })

// For the checks: where things stand right now
window.__labState = () => {
  const quality = video.getVideoPlaybackQuality()
  const end = video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0
  return {
    ...lab,
    position: Math.round(video.currentTime),
    length: Math.round(video.duration || 0),
    paused: video.paused,
    muted: video.muted,
    picture: `${video.videoWidth}x${video.videoHeight}`,
    frames: quality.totalVideoFrames,
    dropped: quality.droppedVideoFrames,
    soundBytes: video.webkitAudioDecodedByteCount,
    bufferedAhead: Math.round(end - video.currentTime),
    memoryMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
  }
}
// Time for a jump to play again
window.__labJump = (to) => new Promise((resolve) => {
  const began = performance.now()
  video.addEventListener('playing', () => resolve(Math.round(performance.now() - began)), { once: true })
  video.currentTime = to
  setTimeout(() => resolve('over 20 s'), 20000)
})
