// A muted piece's picture with another piece's sound put in (player.js: sound saved on this PC or
// borrowed from another quality). A plain page script, before player.js (player.html); also read
// by tests/soundMix.test.ts. Both answer the new piece's bytes, or null if the two don't fit.

// ---- Older videos (.ts) -------------------------------------------------------------------------
// MPEG-TS pieces are 188-byte packets, each tagged with the number of its stream (PID). A table
// (PMT, found through the PAT, stream 0) tells which stream is the sound (AAC, type 0x0F).
const PACKET = 188
function soundStream(bytes) {
  let table = -1
  for (let at = 0; at + PACKET <= bytes.length; at += PACKET) {
    if (bytes[at] !== 0x47) return -1
    if (!(bytes[at + 1] & 0x40)) continue // not the start of something
    const stream = ((bytes[at + 1] & 0x1f) << 8) | bytes[at + 2]
    const field = (bytes[at + 3] >> 4) & 3
    if (field === 2) continue // no content
    let p = at + 4 + (field === 3 ? 1 + bytes[at + 4] : 0)
    p += 1 + bytes[p] // where the table starts
    if (stream === 0) table = ((bytes[p + 10] & 0x1f) << 8) | bytes[p + 11]
    else if (stream === table) {
      const end = p + 3 + (((bytes[p + 1] & 0x0f) << 8) | bytes[p + 2]) - 4
      for (let q = p + 12 + (((bytes[p + 10] & 0x0f) << 8) | bytes[p + 11]); q + 5 <= end; q += 5 + (((bytes[q + 3] & 0x0f) << 8) | bytes[q + 4])) {
        if (bytes[q] === 0x0f) return ((bytes[q + 1] & 0x1f) << 8) | bytes[q + 2]
      }
      return -1
    }
  }
  return -1
}
// The muted piece without its sound, then the other quality's sound renamed to its stream: hls.js
// reads each stream on its own, so their order doesn't matter. null if either can't be read.
function withSoundOf(picture, sound) {
  const a = new Uint8Array(picture)
  const b = new Uint8Array(sound)
  const keep = soundStream(a)
  const take = soundStream(b)
  if (keep < 0 || take < 0 || a.length % PACKET || b.length % PACKET) return null
  const out = new Uint8Array(a.length + b.length)
  let size = 0
  const streamAt = (bytes, at) => ((bytes[at + 1] & 0x1f) << 8) | bytes[at + 2]
  for (let at = 0; at < a.length; at += PACKET) {
    if (streamAt(a, at) === keep) continue
    out.set(a.subarray(at, at + PACKET), size)
    size += PACKET
  }
  for (let at = 0; at < b.length; at += PACKET) {
    if (streamAt(b, at) !== take) continue
    out.set(b.subarray(at, at + PACKET), size)
    out[size + 1] = (out[size + 1] & 0xe0) | (keep >> 8)
    out[size + 2] = keep & 0xff
    size += PACKET
  }
  return out.buffer.slice(0, size)
}

// ---- Newer videos (.mp4) ------------------------------------------------------------------------
// fMP4 boxes: a size, a 4-letter type, then the content (start…end); at = where the box begins
function mp4Boxes(view, from, to) {
  const found = []
  for (let at = from; at + 8 <= to;) {
    let size = view.getUint32(at)
    let head = 8
    if (size === 1) { size = Number(view.getBigUint64(at + 8)); head = 16 }
    if (size === 0) size = to - at
    if (size < head) break
    found.push({ type: String.fromCharCode(view.getUint8(at + 4), view.getUint8(at + 5), view.getUint8(at + 6), view.getUint8(at + 7)), at, start: at + head, end: Math.min(at + size, to) })
    at += size
  }
  return found
}
const mp4Box = (view, box, type) => mp4Boxes(view, box.start, box.end).find((one) => one.type === type)
const mp4All = (view, box, type) => mp4Boxes(view, box.start, box.end).filter((one) => one.type === type)

// One track of a block (traf of a moof at moofAt): its start (tfdt) and its runs of frames (trun),
// each with where its data is and where its frames' sizes are written. null if it can't be read
// or rewritten (data counted from elsewhere than its block, sizes not given per frame…).
function mp4Track(view, moofAt, traf) {
  const tfhd = mp4Box(view, traf, 'tfhd')
  const tfdt = mp4Box(view, traf, 'tfdt')
  if (!tfhd || !tfdt) return null
  const has = view.getUint32(tfhd.start) & 0xffffff
  if (has & 0x1) return null // its own place the data is counted from
  let at = tfhd.start + 8 + (has & 0x2 ? 4 : 0)
  let length = null
  let size = null
  if (has & 0x8) { length = view.getUint32(at); at += 4 }
  if (has & 0x10) size = view.getUint32(at)
  const runs = []
  for (const trun of mp4All(view, traf, 'trun')) {
    const runHas = view.getUint32(trun.start) & 0xffffff
    if (!(runHas & 0x1)) return null // its data right after the run before: not rewritten
    const run = { offsetAt: trun.start + 8, data: moofAt + view.getInt32(trun.start + 8), sizes: [], lengths: [], sizeAt: [] }
    let r = trun.start + 12 + (runHas & 0x4 ? 4 : 0)
    for (let i = view.getUint32(trun.start + 4); i > 0; i--) {
      if (runHas & 0x100) { run.lengths.push(view.getUint32(r)); r += 4 } else run.lengths.push(length)
      if (runHas & 0x200) { run.sizeAt.push(r); run.sizes.push(view.getUint32(r)); r += 4 } else if (size === null) return null
      else run.sizes.push(size)
      if (runHas & 0x400) r += 4
      if (runHas & 0x800) r += 4
    }
    if (r > trun.end) return null
    run.bytes = run.sizes.reduce((sum, one) => sum + one, 0)
    runs.push(run)
  }
  const start = view.getUint8(tfdt.start) === 1 ? Number(view.getBigUint64(tfdt.start + 4)) : view.getUint32(tfdt.start + 4)
  return { start, runs, frames: runs.reduce((sum, run) => sum + run.sizes.length, 0) }
}

// A piece's blocks: each moof with the mdat right after it
function mp4Blocks(top) {
  return top.flatMap((box, i) => (box.type === 'moof' && top[i + 1]?.type === 'mdat' ? [{ moof: box, mdat: top[i + 1] }] : []))
}

// A newer video's piece is ~95 blocks (moof + mdat), each with some sound frames and some picture
// frames; audio-only's piece has the same blocks with the sound only, at the same moments (probe
// 2026-11-26: same starts, frames and sound settings in every quality). So each block's sound
// frames are swapped for audio-only's: the block's description keeps its size (the same number of
// frames, only their sizes change), its data is written again and the picture's data moves. The
// sound track is the one whose start and frame count match audio-only's block: that also checks
// they line up. null if any block doesn't.
function withSoundOfMp4(picture, sound) {
  try {
    const a = new DataView(picture)
    const b = new DataView(sound)
    const theirs = mp4Blocks(mp4Boxes(b, 0, b.byteLength)).map(({ moof, mdat }) => {
      const trafs = mp4All(b, moof, 'traf')
      const track = trafs.length === 1 && mp4Track(b, moof.at, trafs[0])
      if (!track || track.runs.some((run) => run.data < mdat.start || run.data + run.bytes > mdat.end)) return null
      // Its frames in order: size, length (null: not given) and bytes
      const frames = track.runs.flatMap((run) => {
        let at = run.data
        return run.sizes.map((size, i) => ({ size, length: run.lengths[i], bytes: new Uint8Array(sound, (at += size) - size, size) }))
      })
      return { start: track.start, frames }
    })
    const top = mp4Boxes(a, 0, a.byteLength)
    const blocks = mp4Blocks(top)
    if (!blocks.length || blocks.length !== theirs.length || theirs.includes(null)) return null
    const parts = []
    for (const box of top) {
      if (box.type === 'mdat') continue // written with its block (a lone one is dropped)
      const index = blocks.findIndex((one) => one.moof === box)
      if (index < 0) { parts.push(new Uint8Array(picture, box.at, box.end - box.at)); continue }
      const { moof, mdat } = blocks[index]
      const other = theirs[index]
      // The block's description, copied and rewritten
      const copy = new Uint8Array(picture.slice(moof.at, moof.end))
      const view = new DataView(copy.buffer)
      const tracks = mp4All(view, { start: 8, end: copy.length }, 'traf').map((traf) => mp4Track(view, 0, traf))
      if (tracks.includes(null)) return null
      const mine = tracks.find((one) => one.start === other.start && one.frames === other.frames.length)
      if (!mine) return null
      // Its frames' sizes become audio-only's; each run keeps its frames (audio-only's, in order)
      const soundOfRun = new Map()
      let frame = 0
      for (const run of mine.runs) {
        if (run.sizeAt.length !== run.sizes.length) return null // sizes not written per frame
        const frames = other.frames.slice(frame, (frame += run.sizes.length))
        for (const [i, one] of frames.entries()) {
          if (run.lengths[i] !== null && one.length !== null && run.lengths[i] !== one.length) return null // not the same moments
          view.setUint32(run.sizeAt[i], one.size)
        }
        soundOfRun.set(run, frames.map((one) => one.bytes))
      }
      // The data, each run's in its place's order: the picture's as it was, the sound audio-only's
      const runs = tracks.flatMap((track) => track.runs).sort((x, y) => x.data - y.data)
      if (runs.some((run) => moof.at + run.data < mdat.start || moof.at + run.data + run.bytes > mdat.end)) return null
      const data = []
      let size = 8 // the mdat's own size and type
      for (const run of runs) {
        view.setInt32(run.offsetAt, copy.length + size)
        for (const one of soundOfRun.get(run) ?? [new Uint8Array(picture, moof.at + run.data, run.bytes)]) {
          data.push(one)
          size += one.length
        }
      }
      const head = new Uint8Array(8)
      new DataView(head.buffer).setUint32(0, size)
      head.set([0x6d, 0x64, 0x61, 0x74], 4) // 'mdat'
      parts.push(copy, head, ...data)
    }
    const out = new Uint8Array(parts.reduce((sum, one) => sum + one.length, 0))
    let at = 0
    for (const one of parts) { out.set(one, at); at += one.length }
    return out.buffer
  } catch {
    return null // cut short or not fMP4
  }
}
