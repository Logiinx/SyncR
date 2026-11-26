import { readFileSync } from 'node:fs'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

// The saved sound put into a newer video's muted piece (src-tauri/player/soundMix.js): a plain page
// script, loaded here the way a page would, and given made-up fMP4 pieces shaped like Twitch's
// (probe 2026-11-26: ~95 blocks of moof + mdat, sound track 1 then picture track 2).

const code = readFileSync(new URL('../src-tauri/player/soundMix.js', import.meta.url), 'utf8')
const mix = new Function(`${code}\nreturn { withSoundOfMp4 }`)() as { withSoundOfMp4: (picture: ArrayBuffer, sound: ArrayBuffer) => ArrayBuffer | null }

const SOUND = 1
const PICTURE = 2
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const text = (type: string) => [...type].map((one) => one.charCodeAt(0))
const box = (type: string, ...content: number[][]) => {
  const body = content.flat()
  return [...u32(body.length + 8), ...text(type), ...body]
}

type Run = { frames: number[][]; flags?: boolean } // frames: their bytes; flags: per-frame flags given
type Track = { id: number; start: number; runs: Run[] }
// One block: its tracks, and the order their runs' data has in the mdat (track id, run index)
type Block = { tracks: Track[]; order?: [number, number][] }

function trun(run: Run, offset: number) {
  const has = 0x1 | 0x100 | 0x200 | (run.flags ? 0x400 : 0)
  const rows = run.frames.flatMap((frame) => [...u32(1024), ...u32(frame.length), ...(run.flags ? u32(0x2000000) : [])])
  return box('trun', u32(has), u32(run.frames.length), u32(offset), rows)
}
function moof(block: Block, offsets: Map<Run, number>) {
  const trafs = block.tracks.map((track) => box('traf', box('tfhd', u32(0x20000), u32(track.id)), box('tfdt', u32(0), u32(track.start)), ...track.runs.map((run) => trun(run, offsets.get(run) ?? 0))))
  return box('moof', box('mfhd', u32(0), u32(1)), ...trafs)
}
// A piece: an emsg box, then each block's moof and mdat (data offsets counted from the moof)
function piece(blocks: Block[]) {
  const bytes: number[] = [...box('emsg', [1, 2, 3, 4])]
  for (const block of blocks) {
    const runs = (block.order ?? block.tracks.flatMap((track) => track.runs.map((_, i) => [track.id, i] as [number, number])))
      .map(([id, i]) => block.tracks.find((track) => track.id === id)!.runs[i])
    const size = moof(block, new Map()).length
    const offsets = new Map<Run, number>()
    let at = size + 8
    for (const run of runs) {
      offsets.set(run, at)
      at += run.frames.flat().length
    }
    bytes.push(...moof(block, offsets), ...box('mdat', ...runs.map((run) => run.frames.flat())))
  }
  return new Uint8Array(bytes).buffer
}

// Reads a piece back the plain way: per block, each track's start and its frames' bytes
function read(buffer: ArrayBuffer) {
  const view = new DataView(buffer)
  const children = (from: number, to: number) => {
    const out: { type: string; at: number; end: number }[] = []
    for (let at = from; at < to; at += view.getUint32(at)) out.push({ type: String.fromCharCode(...new Uint8Array(buffer, at + 4, 4)), at, end: at + view.getUint32(at) })
    return out
  }
  const top = children(0, buffer.byteLength)
  return {
    types: top.map((one) => one.type),
    blocks: top.filter((one) => one.type === 'moof').map((m) => children(m.at + 8, m.end).filter((one) => one.type === 'traf').map((traf) => {
      const kids = children(traf.at + 8, traf.end)
      const id = view.getUint32(kids.find((one) => one.type === 'tfhd')!.at + 12)
      const start = view.getUint32(kids.find((one) => one.type === 'tfdt')!.at + 12)
      const frames = kids.filter((one) => one.type === 'trun').flatMap((t) => {
        const has = view.getUint32(t.at + 8) & 0xffffff
        const step = 8 + (has & 0x400 ? 4 : 0)
        let data = m.at + view.getInt32(t.at + 16)
        return Array.from({ length: view.getUint32(t.at + 12) }, (_, i) => {
          const size = view.getUint32(t.at + 20 + i * step + 4)
          data += size
          return [...new Uint8Array(buffer, data - size, size)]
        })
      })
      return { id, start, frames }
    })),
  }
}

const frames = (count: number, size: number, seed: number) => Array.from({ length: count }, (_, i) => Array.from({ length: size + (i % 3) }, (_, j) => (seed + i * 7 + j) & 255))
const silent = (count: number) => Array.from({ length: count }, () => [0x21, 0x10, 0x04, 0x60, 0x8c, 0x1c])
// A muted piece and audio-only's: same starts and frame counts, sound (track 1) first in the mdat
function pair(blocks: number) {
  const starts = Array.from({ length: blocks }, (_, i) => 331297840 + i * 5 * 1024)
  const muted = piece(starts.map((start, i) => ({ tracks: [
    { id: SOUND, start, runs: [{ frames: silent(5), flags: true }] },
    { id: PICTURE, start: 900000 + i * 3000, runs: [{ frames: frames(8, 40, i), flags: true }] },
  ] })))
  const sounds = starts.map((_, i) => frames(5, 12, 100 + i))
  const saved = piece(starts.map((start, i) => ({ tracks: [{ id: SOUND, start, runs: [{ frames: sounds[i] }] }] })))
  return { muted, saved, sounds }
}

describe('saved sound in a .mp4 piece', () => {
  it('swaps each block’s sound and keeps its picture', () => {
    const { muted, saved, sounds } = pair(3)
    const out = mix.withSoundOfMp4(muted, saved)!
    expect(out).not.toBeNull()
    const before = read(muted)
    const after = read(out)
    expect(after.types).toEqual(before.types) // emsg kept, same blocks
    after.blocks.forEach((tracks, i) => {
      expect(tracks.map((one) => [one.id, one.start])).toEqual(before.blocks[i].map((one) => [one.id, one.start]))
      expect(tracks[0].frames).toEqual(sounds[i])
      expect(tracks[1].frames).toEqual(before.blocks[i][1].frames)
    })
  })

  it('works whatever order the data has, and a sound split in runs', () => {
    const sound = frames(6, 9, 1)
    const picture = frames(4, 30, 2)
    const muted = piece([{
      tracks: [
        { id: SOUND, start: 4096, runs: [{ frames: silent(2), flags: true }, { frames: silent(4), flags: true }] },
        { id: PICTURE, start: 777, runs: [{ frames: picture }] },
      ],
      order: [[PICTURE, 0], [SOUND, 1], [SOUND, 0]],
    }])
    const saved = piece([{ tracks: [{ id: SOUND, start: 4096, runs: [{ frames: sound.slice(0, 3) }, { frames: sound.slice(3) }] }] }])
    const out = read(mix.withSoundOfMp4(muted, saved)!)
    expect(out.blocks[0][0].frames).toEqual(sound)
    expect(out.blocks[0][1].frames).toEqual(picture)
  })

  it('finds the sound track by its start and frames, wherever it is', () => {
    const sound = frames(5, 10, 3)
    const muted = piece([{ tracks: [{ id: 7, start: 50, runs: [{ frames: frames(5, 30, 4) }] }, { id: 9, start: 2048, runs: [{ frames: silent(5) }] }] }])
    const saved = piece([{ tracks: [{ id: 1, start: 2048, runs: [{ frames: sound }] }] }])
    const out = read(mix.withSoundOfMp4(muted, saved)!)
    expect(out.blocks[0][1].frames).toEqual(sound)
    expect(out.blocks[0][0].frames).toEqual(frames(5, 30, 4))
  })

  it('gives up when the two don’t line up', () => {
    const { muted, saved } = pair(3)
    const one = (start: number, count: number) => ({ tracks: [{ id: SOUND, start, runs: [{ frames: frames(count, 12, 0) }] }] })
    const starts = [0, 1, 2].map((i) => 331297840 + i * 5 * 1024)
    expect(mix.withSoundOfMp4(muted, piece(starts.map((start, i) => one(i === 1 ? start + 1 : start, 5))))).toBeNull() // another moment
    expect(mix.withSoundOfMp4(muted, piece(starts.map((start, i) => one(start, i === 2 ? 4 : 5))))).toBeNull() // a frame less
    expect(mix.withSoundOfMp4(muted, piece(starts.slice(0, 2).map((start) => one(start, 5))))).toBeNull() // a block less
    expect(mix.withSoundOfMp4(muted, saved.slice(0, saved.byteLength - 20))).toBeNull() // cut short
    expect(mix.withSoundOfMp4(muted.slice(0, 600), saved)).toBeNull()
    expect(mix.withSoundOfMp4(new Uint8Array(500).fill(7).buffer, saved)).toBeNull() // not fMP4
    expect(mix.withSoundOfMp4(muted, new ArrayBuffer(0))).toBeNull()
  })

  it('keeps every frame in place for any sizes, runs and order', () => {
    const run = fc.array(fc.integer({ min: 1, max: 40 }), { minLength: 1, maxLength: 6 })
    fc.assert(fc.property(fc.array(fc.record({ sound: fc.array(run, { minLength: 1, maxLength: 3 }), picture: fc.array(run, { minLength: 1, maxLength: 3 }), split: fc.integer({ min: 1, max: 5 }), shuffle: fc.integer() }), { minLength: 1, maxLength: 4 }), (shapes) => {
      const make = (sizes: number[], seed: number) => sizes.map((size, i) => Array.from({ length: size }, (_, j) => (seed * 31 + i * 7 + j) & 255))
      const blocks = shapes.map((shape, b) => {
        const count = shape.sound.flat().length
        const soundRuns = shape.sound.map((sizes) => ({ frames: silent(sizes.length), flags: true }))
        const pictureRuns = shape.picture.map((sizes, i) => ({ frames: make(sizes, b * 10 + i) }))
        const order = [...soundRuns.map((_, i) => [SOUND, i]), ...pictureRuns.map((_, i) => [PICTURE, i])] as [number, number][]
        order.sort((x, y) => ((x[0] * 7 + x[1] * 13 + shape.shuffle) % 5) - ((y[0] * 7 + y[1] * 13 + shape.shuffle) % 5))
        const sound = make(Array.from({ length: count }, (_, i) => 1 + ((i * shape.split) % 37)), 50 + b)
        return { start: 1024 * 100 * b, count, sound, muted: { tracks: [{ id: SOUND, start: 1024 * 100 * b, runs: soundRuns }, { id: PICTURE, start: 3 + b, runs: pictureRuns }], order } }
      })
      const savedBlocks = blocks.map((one) => {
        const cut = Math.min(Math.max(1, one.count >> 1), one.count)
        const runs = cut < one.count ? [{ frames: one.sound.slice(0, cut) }, { frames: one.sound.slice(cut) }] : [{ frames: one.sound }]
        return { tracks: [{ id: SOUND, start: one.start, runs }] }
      })
      const muted = piece(blocks.map((one) => one.muted))
      const out = mix.withSoundOfMp4(muted, piece(savedBlocks))
      expect(out).not.toBeNull()
      const after = read(out!)
      after.blocks.forEach((tracks, b) => {
        expect(tracks[0].frames).toEqual(blocks[b].sound)
        expect(tracks[1].frames).toEqual(blocks[b].muted.tracks[1].runs.flatMap((r) => r.frames))
      })
    }), { numRuns: 200 })
  })
})
