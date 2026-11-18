// Own preview pictures for the bar's tip, while Twitch has none (uses player.js's hls and
// controls.js's $ and showPicture). Twitch makes its own list only once a stream is over, so a
// stream still live has none; timeline.js asks for it again then, and drops these (dropOwnPictures).
// Light on Twitch: only while the bar is hovered, one small download at a time, never in the
// background. A piece starts with a whole picture: the first ~6 KB of a 160p piece is enough.
const OWN = {
  spots: 200, // close spots share a picture: about as many as Twitch's own list
  gap: 250, // ms between two downloads at least
  keep: 300, // pictures kept at most (the oldest go)
  widest: 440, // px kept (shown 220 wide, sharp on a scaled screen)
  most: 262144, // bytes asked for one picture at most
  fails: 5, // pieces failing in a row: no more pictures for this video
  idle: 5000, // ms after the last picture: the decoder is closed
}
const ownPictures = new Map() // piece index → picture for showPicture, the oldest used first
const ownFailed = new Set() // piece indexes that gave no picture (not asked again)
const ownInits = new Map() // .mp4 pieces' setup file address → its video track (or a promise of it)
let ownWanted = null // { index, piece, init } hovered last, waiting for its turn
let ownBusy = false
let ownLastAt = 0
let ownTimer
let ownFailsInRow = 0
let ownStopped = false // Twitch's own list came, Twitch refused, or this video can't be decoded
let ownRefused = false // Twitch refused, or this video can't be decoded: no refining either
let ownHovered = 0 // seconds hovered last
let ownDecoder = null
let ownDecoderKey = ''
let ownFrame = null
let ownIdleTimer

// The quality with the smallest pieces (160p, or the lowest one offered): { address, height }
function ownLevel() {
  let low = null
  for (const level of hls?.levels ?? []) {
    const address = level.url?.[0] // hls.js keeps a list (backup addresses)
    if (address && (!low || (level.height || 9999) < (low.height || 9999))) low = { address, height: level.height }
  }
  return low
}

// The piece playing at a moment, in the quality playing (all qualities share the pieces' names)
function ownPieceAt(seconds) {
  const level = hls?.levels[hls.currentLevel] ?? hls?.levels[hls.loadLevel]
  const pieces = level?.details?.fragments ?? []
  let low = 0
  let high = pieces.length - 1
  if (high < 0) return null
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (pieces[middle].start <= seconds) low = middle
    else high = middle - 1
  }
  return { index: low, piece: pieces[low], count: pieces.length }
}

// The same file in the smallest quality's folder
const ownAddress = (folderOf, url) => `${folderOf.slice(0, folderOf.lastIndexOf('/'))}/${url.slice(url.lastIndexOf('/') + 1)}`

// What the tip shows at a moment: the closest picture made (right away), and the right one asked for
function ownPictureAt(seconds) {
  // A small player shows no pictures: none downloaded
  if (ownStopped || typeof VideoDecoder === 'undefined' || !pictureRoom()) return null
  const found = ownPieceAt(seconds)
  const level = ownLevel()
  if (!found || !level) return null
  ownHovered = seconds
  const { index, piece, count } = found
  const near = Math.max(1, Math.round(count / OWN.spots / 2)) // pieces either side that count as here
  let closest = null
  let closestGap = Infinity
  for (const at of ownPictures.keys()) {
    const gap = Math.abs(at - index)
    if (gap < closestGap) [closest, closestGap] = [at, gap]
  }
  if (closest !== null && closestGap <= near) {
    ownWanted = null
    return ownUse(closest)
  }
  if (!ownFailed.has(index)) {
    ownWanted = { index, piece: ownAddress(level.address, piece.url), init: piece.initSegment?.url ? ownAddress(level.address, piece.initSegment.url) : null, height: level.height || 0 }
    ownNext()
  }
  return closest === null ? null : ownUse(closest)
}

// Marks a picture as just used (the oldest used go first)
function ownUse(index) {
  const picture = ownPictures.get(index)
  ownPictures.delete(index)
  ownPictures.set(index, picture)
  return picture
}

// The spot hovered last gets its picture, when its turn comes
function ownNext() {
  if (ownBusy || !ownWanted || ownStopped) return
  const wait = ownLastAt + OWN.gap - performance.now()
  if (wait > 0) {
    clearTimeout(ownTimer)
    ownTimer = setTimeout(ownNext, wait)
    return
  }
  const wanted = ownWanted
  ownWanted = null
  // The mouse left the bar meanwhile, or that spot was just tried: nothing to download
  if ($('tip').hidden || ownFailed.has(wanted.index) || ownPictures.has(wanted.index)) return
  ownBusy = true
  ownLastAt = performance.now()
  ownMake(wanted).then((picture) => {
    ownFailsInRow = 0
    if (ownStopped) return void URL.revokeObjectURL(picture.address)
    ownPictures.set(wanted.index, picture)
    while (ownPictures.size > OWN.keep) {
      const [oldest, old] = ownPictures.entries().next().value
      ownPictures.delete(oldest)
      URL.revokeObjectURL(old.address)
    }
    if (!$('tip').hidden) showPicture(ownPictureAt(ownHovered))
  }).catch((error) => {
    console.error(error)
    // Not tried again: refused by Twitch (429, 403) stops them all; offline, the next hover tries
    if (error.stopAll) {
      ownRefused = true
      return dropOwnPictures()
    }
    if (navigator.onLine === false) return
    ownFailed.add(wanted.index)
    if (++ownFailsInRow >= OWN.fails) dropOwnPictures()
  }).finally(() => {
    ownBusy = false
    ownNext()
  })
}

// All of them gone, for good (Twitch's own came, or they can't be had)
function dropOwnPictures() {
  ownStopped = true
  ownWanted = null
  clearTimeout(ownTimer)
  for (const picture of ownPictures.values()) URL.revokeObjectURL(picture.address)
  ownPictures.clear()
  ownInits.clear()
  closeOwnDecoder()
}
addEventListener('pagehide', dropOwnPictures)

// ---- Downloading ----------------------------------------------------------------------------------
async function ownBytes(url, from, to) {
  const response = await fetch(url, { headers: { Range: `bytes=${from}-${to}` } })
  if (response.status === 429 || response.status === 403) throw Object.assign(new Error(`Pieces answered ${response.status}`), { stopAll: true })
  if (!response.ok) throw new Error(`Piece answered ${response.status}`)
  // Whole pieces instead of their start: too heavy, so no own pictures at all
  if (response.status !== 206) {
    response.body?.cancel()
    throw Object.assign(new Error(`Piece answered ${response.status}, not a part`), { stopAll: true })
  }
  return new Uint8Array(await response.arrayBuffer())
}

// Asks for the start of a piece, then more while `enough` says how many bytes it needs in all
// (0: enough, null: no picture there)
async function ownStart(url, first, enough) {
  let bytes = await ownBytes(url, 0, first - 1)
  let ended = bytes.length < first // a short answer: that's the whole piece
  for (;;) {
    const needs = enough(bytes)
    if (needs === 0) return bytes
    if (needs === null || ended || bytes.length >= OWN.most) throw new Error('No picture at the piece\'s start')
    const to = Math.min(needs, OWN.most) - 1
    const more = await ownBytes(url, bytes.length, to)
    ended = more.length < to + 1 - bytes.length
    const joined = new Uint8Array(bytes.length + more.length)
    joined.set(bytes)
    joined.set(more, bytes.length)
    bytes = joined
  }
}

// Enough for the first picture almost always, from the quality's height (measured: 160p 5–14 KB,
// 360p 15 KB, 1080p 86 KB): one request is better than two smaller ones
const ownFirst = (height) => (height <= 200 ? 20480 : height <= 400 ? 40960 : height <= 800 ? 98304 : 163840)

async function ownMake({ piece, init, height }) {
  const first = ownFirst(height)
  const { config, data } = init ? await ownFromMp4(piece, init, first) : await ownFromTs(piece, first)
  const frame = await ownDecode(config, data)
  try {
    const width = Math.min(frame.displayWidth, OWN.widest)
    const tall = Math.round(width * frame.displayHeight / frame.displayWidth)
    const canvas = new OffscreenCanvas(width, tall)
    canvas.getContext('2d').drawImage(frame, 0, 0, width, tall)
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
    return { address: URL.createObjectURL(blob), width, height: tall, cols: 1, column: 0, row: 0 }
  } finally {
    frame.close()
  }
}

// ---- .ts pieces -------------------------------------------------------------------------------------
// Packets of 188 bytes; the first video packet group (PES) is the first picture, with its setup
function ownTsPicture(bytes) {
  let tablePid = -1
  let videoPid = -1
  const parts = []
  let started = false
  for (let at = 0; at + 188 <= bytes.length; at += 188) {
    if (bytes[at] !== 0x47) return { broken: true }
    const start = (bytes[at + 1] & 0x40) !== 0
    const pid = ((bytes[at + 1] & 0x1f) << 8) | bytes[at + 2]
    const fields = (bytes[at + 3] >> 4) & 3
    let p = at + 4
    if (fields & 2) p += 1 + bytes[p]
    if (!(fields & 1) || p >= at + 188) continue
    if (pid === 0 && start) {
      p += 1 + bytes[p]
      tablePid = ((bytes[p + 10] & 0x1f) << 8) | bytes[p + 11]
    } else if (pid === tablePid && start && videoPid < 0) {
      p += 1 + bytes[p]
      const end = p + 3 + (((bytes[p + 1] & 0xf) << 8) | bytes[p + 2]) - 4
      let q = p + 12 + (((bytes[p + 10] & 0xf) << 8) | bytes[p + 11])
      while (q + 5 <= end) {
        if (bytes[q] === 0x1b) { videoPid = ((bytes[q + 1] & 0x1f) << 8) | bytes[q + 2]; break }
        q += 5 + (((bytes[q + 3] & 0xf) << 8) | bytes[q + 4])
      }
      if (videoPid < 0) return { notH264: true } // HEVC or other: can't be decoded here
    } else if (pid === videoPid) {
      if (start && started) return { data: ownJoin(parts) }
      if (start) {
        started = true
        p += 9 + bytes[p + 8]
      }
      if (started && p < at + 188) parts.push(bytes.subarray(p, at + 188))
    }
  }
  return { more: true }
}

const ownJoin = (parts) => {
  const joined = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    joined.set(part, at)
    at += part.length
  }
  return joined
}

const hex = (byte) => byte.toString(16).padStart(2, '0')

async function ownFromTs(url, first) {
  let found = null
  const bytes = await ownStart(url, first, (bytes) => {
    found = ownTsPicture(bytes)
    if (found.notH264) throw Object.assign(new Error('Not an H.264 piece'), { stopAll: true })
    return found.broken ? null : found.data ? 0 : bytes.length * 2
  })
  // Its setup (SPS) names the codec
  const data = found.data
  for (let at = 0; at + 7 < data.length; at++) {
    if (data[at] === 0 && data[at + 1] === 0 && data[at + 2] === 1 && (data[at + 3] & 0x1f) === 7) {
      return { config: { codec: `avc1.${hex(data[at + 4])}${hex(data[at + 5])}${hex(data[at + 6])}`, optimizeForLatency: true }, data }
    }
  }
  throw new Error('No picture setup in the piece')
}

// ---- .mp4 pieces ------------------------------------------------------------------------------------
// Boxes: 4 bytes of size, 4 of name. Inside a box's range: [{ type, at (its content), end }]
function ownBoxes(bytes, from, to) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const boxes = []
  let at = from
  while (at + 8 <= to) {
    let size = view.getUint32(at)
    let head = 8
    if (size === 1 && at + 16 <= to) {
      size = Number(view.getBigUint64(at + 8))
      head = 16
    }
    if (size === 0) size = to - at
    if (size < head) break
    boxes.push({ type: String.fromCharCode(...bytes.subarray(at + 4, at + 8)), start: at, at: at + head, end: at + size })
    at += size
  }
  return boxes
}
const ownBox = (bytes, box, type) => ownBoxes(bytes, box.at, Math.min(box.end, bytes.length)).find((one) => one.type === type)

// The setup file: which track is the video, and its codec setup (avcC)
async function ownInit(url) {
  if (!ownInits.has(url)) {
    ownInits.set(url, (async () => {
      const response = await fetch(url)
      if (response.status === 429 || response.status === 403) throw Object.assign(new Error(`Setup answered ${response.status}`), { stopAll: true })
      if (!response.ok) throw new Error(`Setup answered ${response.status}`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      const view = new DataView(bytes.buffer)
      const moov = ownBoxes(bytes, 0, bytes.length).find((one) => one.type === 'moov')
      for (const trak of moov ? ownBoxes(bytes, moov.at, moov.end).filter((one) => one.type === 'trak') : []) {
        const tkhd = ownBox(bytes, trak, 'tkhd')
        const mdia = ownBox(bytes, trak, 'mdia')
        const hdlr = mdia && ownBox(bytes, mdia, 'hdlr')
        if (!tkhd || !hdlr || String.fromCharCode(...bytes.subarray(hdlr.at + 8, hdlr.at + 12)) !== 'vide') continue
        const track = view.getUint32(tkhd.at + (bytes[tkhd.at] === 1 ? 20 : 12))
        const minf = ownBox(bytes, mdia, 'minf')
        const stbl = minf && ownBox(bytes, minf, 'stbl')
        const stsd = stbl && ownBox(bytes, stbl, 'stsd')
        const entry = stsd && ownBoxes(bytes, stsd.at + 8, stsd.end)[0]
        // Not H.264 (HEVC, AV1): left out
        if (!entry || entry.type !== 'avc1') throw Object.assign(new Error(`Pieces in ${entry?.type}`), { stopAll: true })
        const avcC = ownBoxes(bytes, entry.at + 78, entry.end).find((one) => one.type === 'avcC')
        if (!avcC) break
        const description = bytes.slice(avcC.at, avcC.end)
        return { track, config: { codec: `avc1.${hex(description[1])}${hex(description[2])}${hex(description[3])}`, description, optimizeForLatency: true } }
      }
      throw new Error('No video in the setup')
    })())
    // Failed: asked again next time (a hiccup), unless all stopped
    ownInits.get(url).catch(() => ownInits.delete(url))
  }
  return ownInits.get(url)
}

// Where the first video picture lies: { from, to } (bytes), or how many bytes it still needs
function ownMp4Picture(bytes, track) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const moof = ownBoxes(bytes, 0, bytes.length).find((one) => one.type === 'moof')
  if (!moof) return { needs: bytes.length * 2 }
  if (moof.end > bytes.length) return { needs: moof.end }
  for (const traf of ownBoxes(bytes, moof.at, moof.end).filter((one) => one.type === 'traf')) {
    const tfhd = ownBox(bytes, traf, 'tfhd')
    const trun = ownBox(bytes, traf, 'trun')
    if (!tfhd || !trun || view.getUint32(tfhd.at + 4) !== track) continue
    const boxFlags = view.getUint32(tfhd.at) & 0xffffff
    let at = tfhd.at + 8
    let base = moof.start
    if (boxFlags & 0x1) { base = Number(view.getBigUint64(at)); at += 8 }
    if (boxFlags & 0x2) at += 4
    if (boxFlags & 0x8) at += 4
    const defaultSize = boxFlags & 0x10 ? view.getUint32(at) : 0
    const flags = view.getUint32(trun.at) & 0xffffff
    let p = trun.at + 8
    const offset = flags & 0x1 ? view.getInt32(p) : 0
    if (flags & 0x1) p += 4
    if (flags & 0x4) p += 4
    if (flags & 0x100) p += 4
    const size = flags & 0x200 ? view.getUint32(p) : defaultSize
    if (!size) return { fail: true }
    const from = base + offset
    return from + size <= bytes.length ? { from, to: from + size } : { needs: from + size }
  }
  return { fail: true }
}

async function ownFromMp4(url, initUrl, first) {
  const { track, config } = await ownInit(initUrl)
  let found = null
  const bytes = await ownStart(url, first, (bytes) => {
    found = ownMp4Picture(bytes, track)
    if (found.fail) return null
    return found.needs ?? 0
  })
  return { config, data: bytes.slice(found.from, found.to) }
}

// ---- Decoding -----------------------------------------------------------------------------------------
// One decoder, kept while pictures are asked for, closed once the bar isn't hovered
async function ownDecode(config, data) {
  clearTimeout(ownIdleTimer)
  if (!ownDecoder || ownDecoder.state === 'closed') {
    ownDecoder = new VideoDecoder({
      output: (frame) => {
        ownFrame?.close()
        ownFrame = frame
      },
      error: (error) => console.error(error),
    })
    ownDecoderKey = ''
  }
  const key = `${config.codec} ${config.description ? [...config.description].join(',') : ''}`
  if (key !== ownDecoderKey) {
    const { supported } = await VideoDecoder.isConfigSupported(config)
    if (!supported) throw Object.assign(new Error(`Can't decode ${config.codec}`), { stopAll: true })
    ownDecoder.configure(config)
    ownDecoderKey = key
  }
  try {
    ownDecoder.decode(new EncodedVideoChunk({ type: 'key', timestamp: 0, data }))
    await ownDecoder.flush()
    const frame = ownFrame
    ownFrame = null
    if (!frame) throw new Error('No picture decoded')
    return frame
  } catch (error) {
    closeOwnDecoder()
    throw error
  } finally {
    clearTimeout(ownIdleTimer)
    ownIdleTimer = setTimeout(closeOwnDecoder, OWN.idle)
  }
}

function closeOwnDecoder() {
  clearTimeout(ownIdleTimer)
  ownFrame?.close()
  ownFrame = null
  if (ownDecoder && ownDecoder.state !== 'closed') ownDecoder.close()
  ownDecoder = null
  ownDecoderKey = ''
}

// ---- For the waiting screen's refining (timeline.js, checkStart) --------------------------------
// The first picture of the piece playing at a moment, as startSkip.js compares it, and when that
// piece starts: { at, picture }, or null when it can't be had. Also once Twitch's own list came
// (the tip's own pictures stop then, these don't). Same care: one download at a time, OWN.gap apart.
const ownSleep = (ms) => new Promise((done) => setTimeout(done, ms))
async function ownSkipPicture(seconds) {
  if (ownRefused || typeof VideoDecoder === 'undefined') return null
  // The pieces' list comes with the video's first load
  for (let waited = 0; !ownPieceAt(0); waited += 500) {
    if (waited >= 30000) return null
    await ownSleep(500)
  }
  const found = ownPieceAt(seconds)
  const level = ownLevel()
  if (!found || !level) return null
  while (ownBusy || performance.now() < ownLastAt + OWN.gap) await ownSleep(Math.max(ownLastAt + OWN.gap - performance.now(), 50))
  ownBusy = true
  ownLastAt = performance.now()
  try {
    const piece = ownAddress(level.address, found.piece.url)
    const init = found.piece.initSegment?.url ? ownAddress(level.address, found.piece.initSegment.url) : null
    const first = ownFirst(level.height || 0)
    const { config, data } = init ? await ownFromMp4(piece, init, first) : await ownFromTs(piece, first)
    const frame = await ownDecode(config, data)
    try {
      return { at: found.piece.start, picture: skipPicture(frame, 0, 0, frame.displayWidth, frame.displayHeight) }
    } finally {
      frame.close()
    }
  } catch (error) {
    console.error(error)
    if (error.stopAll) ownRefused = true
    return null
  } finally {
    ownBusy = false
    ownNext()
  }
}
