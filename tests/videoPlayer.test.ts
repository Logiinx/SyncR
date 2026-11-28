import { beforeEach, expect, test, vi } from 'vitest'

// The player window's side in the app (videoPlayer.ts), with fake window messages: opening a video
// another way goes on from where it is, and a watched video played again stays out of the Queue.

vi.mock('../src/i18n', () => ({ t: (text: string) => text, locale: () => 'en' }))
vi.mock('../src/animations', () => ({ animationsOn: () => true }))
vi.mock('../src/appearance', () => ({ currentZoom: () => 1, grayColors: (names: string[]) => Object.fromEntries(names.map((name) => [name, ''])), loadAppearance: () => ({ background: 'gray' }) }))
vi.mock('../src/links', () => ({ openLink: () => {} }))
const store = new Map<string, unknown>()
vi.mock('../src/localState', () => ({
  read: (key: string, fallback: unknown) => (store.has(key) ? structuredClone(store.get(key)) : fallback),
  write: (key: string, value: unknown) => void store.set(key, structuredClone(value)),
}))
const watchedSet: string[] = []
let watchedChange = (_watched: boolean) => {} // the open video's Watched mark, ticked in the list
// A Twitch stream's next part (videoParts.ts): on this device, and Twitch's answer
const part = { id: 'twitch-456', platform: 'twitch' as const, title: 'Subathon, part 2', channelId: 'c', url: 'https://www.twitch.tv/videos/456', thumbnail: null, watched: false, duration: 7200, live: true }
let knownPart: typeof part | null = null
let askedPart: { part: typeof part | null; end: number | null } = { part: null, end: 0 }
vi.mock('../src/videoParts', () => ({ PART_GAP: 30 * 60_000, knownNextPart: async () => knownPart, askNextPart: async () => askedPart }))
vi.mock('../src/video', () => ({
  addOrFindVideo: async () => ({ video: { ...part, thumbnail: undefined } }),
  markOpened: async () => {},
  setWatched: async (id: string) => void watchedSet.push(id),
  watchWatched: (_id: string, onChange: (watched: boolean) => void) => {
    watchedChange = onChange
    return () => {}
  },
  followOfChannel: () => undefined,
  channelKey: (of: { platform: string; channelId: string }) => `${of.platform} ${of.channelId}`,
  loadFollowsNow: async () => {},
  setFollowStartSkip: async () => {},
}))
vi.mock('../src/videoPlaylists', () => ({ nextInPlaylist: async () => null }))
const queued: string[] = [] // put first (opened by hand)
const joined: string[] = [] // joined at the top only when not in it (opened by ⏭ or one after another)
vi.mock('../src/videoQueue', () => ({ queueOpened: (id: string) => void queued.push(id), queueStarted: (id: string) => void joined.push(id) }))
const calls: { command: string; args: Record<string, unknown> }[] = []
let windowOpen = true
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: async (command: string, args: Record<string, unknown>) => {
    calls.push({ command, args })
    return command === 'video_player_upcoming' ? windowOpen : undefined
  },
}))
const handlers = new Map<string, (event: { payload: unknown }) => void>()
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (name: string, handler: (event: { payload: unknown }) => void) => void handlers.set(name, handler),
}))
;(globalThis as Record<string, unknown>).document = { documentElement: {} }
;(globalThis as Record<string, unknown>).getComputedStyle = () => ({ getPropertyValue: () => '' })

const { playVideo } = await import('../src/videoPlayer')
const { resumePosition } = await import('../src/videoPositions')

const video = (watched = false) => ({ id: 'youtube-abcdefghijk', platform: 'youtube' as const, title: 'A video', channelId: 'c', url: 'https://youtu.be/abcdefghijk', watched, duration: 3600 })
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const send = (name: string, payload: unknown) => handlers.get(name)!({ payload })

beforeEach(() => {
  store.clear()
  calls.length = 0
  queued.length = 0
  joined.length = 0
  watchedSet.length = 0
  knownPart = null
  askedPart = { part: null, end: 0 }
  windowOpen = true
  vi.useRealTimers()
})

// Opens it, then 4 s later (past the first reports of a page being replaced) it reports a place
async function openAndPlayTo(seconds: number, watched = false, start?: number) {
  playVideo(video(watched), undefined, start)
  await settle()
  vi.useFakeTimers({ now: Date.now() + 4000, toFake: ['Date'] })
  send('video-position', { t: seconds, length: 3600 })
}

test('another way goes on from where the video is, not from the link’s time', async () => {
  await openAndPlayTo(900, false, 600)
  send('video-bar', { action: 'another-way' })
  await settle()
  const way = calls.find((call) => call.command === 'video_player_way')!
  expect(way.args.address).toMatch(/[?&]t=900/) // the next way is yout-ube.com
  expect(way.args.address).not.toMatch(/[?&]t=600/)
})

test('a watched video played again: another way goes on from where it is, not from 0', async () => {
  await openAndPlayTo(900, true)
  send('video-bar', { action: 'another-way' })
  await settle()
  expect(calls.find((call) => call.command === 'video_player_way')!.args.address).toMatch(/[?&]t=900/)
})

test('a watched video played again stays out of the Queue', async () => {
  await openAndPlayTo(900, true)
  expect(queued).toEqual([])
})

test('a video stopped partway joins the Queue', async () => {
  await openAndPlayTo(900)
  expect(queued).toEqual(['youtube-abcdefghijk'])
})

test('it goes first in the Queue once per opening, again when opened again', async () => {
  await openAndPlayTo(900)
  send('video-position', { t: 905, length: 3600 }) // a later report: not again (dragged meanwhile, it stays there)
  expect(queued).toEqual(['youtube-abcdefghijk'])
  vi.useRealTimers()
  await openAndPlayTo(910)
  expect(queued).toEqual(['youtube-abcdefghijk', 'youtube-abcdefghijk'])
})

test('taken out of Watched while it plays, it joins the Queue again', async () => {
  await openAndPlayTo(900)
  watchedChange(true) // it left the Queue (video.ts)
  watchedChange(false)
  send('video-position', { t: 905, length: 3600 })
  expect(queued).toEqual(['youtube-abcdefghijk', 'youtube-abcdefghijk'])
})

test('the next one opened by ⏭ keeps its place in the Queue', async () => {
  const next = { ...video(), id: 'youtube-bbbbbbbbbbb', url: 'https://youtu.be/bbbbbbbbbbb' }
  playVideo(video(), undefined, undefined, [{ video: next }])
  await settle()
  vi.useFakeTimers({ now: Date.now() + 4000, toFake: ['Date'] })
  send('video-position', { t: 900, length: 3600 })
  send('video-next', {})
  await settle()
  vi.setSystemTime(Date.now() + 4000)
  send('video-position', { t: 300, length: 3600 })
  expect(queued).toEqual(['youtube-abcdefghijk'])
  expect(joined).toEqual(['youtube-bbbbbbbbbbb'])
})

// A Twitch stream still live, in our own player, played to the end of what's recorded so far
// waits: also a fake setTimeout, for the waits at its end (advanced by the test)
async function playLiveToItsEnd(finished: boolean, live = true, waits = false) {
  playVideo({ id: 'twitch-123', platform: 'twitch', title: 'Subathon', channelId: 'c', url: 'https://www.twitch.tv/videos/123', watched: false, duration: 3600, live })
  await settle()
  vi.useFakeTimers({ now: Date.now() + 4000, toFake: waits ? ['Date', 'setTimeout'] : ['Date'] })
  if (finished) send('video-note', { code: 'finished', video: '123' })
  send('video-position', { t: 3600, length: 3600 })
}

test('a live stream’s end is no end: not Watched, the window stays, and it goes on from there', async () => {
  await playLiveToItsEnd(false)
  expect(watchedSet).toEqual([])
  expect(calls.some((call) => call.command === 'close_video_player')).toBe(false)
  expect(resumePosition('twitch-123')?.t).toBe(3600)
})

test('once our player says the stream is over, its end counts again', async () => {
  await playLiveToItsEnd(true)
  expect(watchedSet).toEqual(['twitch-123'])
  await vi.waitFor(() => expect(calls.some((call) => call.command === 'close_video_player')).toBe(true))
})

const played = () => calls.find((call) => call.command === 'video_player_next')

test('a stream’s next part plays on at its end, whatever the setting', async () => {
  knownPart = part
  await playLiveToItsEnd(true, false)
  await vi.waitFor(() => expect(played()?.args.title).toBe('Subathon, part 2'))
  expect(calls.some((call) => call.command === 'close_video_player')).toBe(false)
})

test('once found, the next part shows on ⏭ while the stream plays', async () => {
  askedPart = { part, end: Date.now() }
  await playLiveToItsEnd(false)
  send('video-note', { code: 'finished', video: '123' })
  await vi.waitFor(() => expect(calls.find((call) => call.command === 'video_player_upcoming')?.args.upcoming).toEqual({ title: 'Subathon, part 2', thumbnail: null }))
})

test('a part that can still come (a restart) is waited for at the end', async () => {
  askedPart = { part: null, end: Date.now() + 4000 } // just ended (the test's clock jumps 4 s)
  await playLiveToItsEnd(true, true, true)
  await vi.advanceTimersByTimeAsync(1000)
  expect(played()).toBeUndefined()
  expect(calls.some((call) => call.command === 'close_video_player')).toBe(false)
  askedPart = { part, end: Date.now() } // the restart: Twitch has it a minute later
  await vi.advanceTimersByTimeAsync(60_000)
  vi.useRealTimers()
  await vi.waitFor(() => expect(played()?.args.title).toBe('Subathon, part 2'))
})

test('no next part comes within 10 min: the usual end', async () => {
  askedPart = { part: null, end: Date.now() + 4000 }
  await playLiveToItsEnd(true, true, true)
  await vi.advanceTimersByTimeAsync(10 * 60_000 + 1000)
  vi.useRealTimers()
  await vi.waitFor(() => expect(calls.some((call) => call.command === 'close_video_player')).toBe(true))
  expect(played()).toBeUndefined()
})

test('the window closed while waiting at the end: nothing plays', async () => {
  askedPart = { part: null, end: Date.now() + 4000 }
  await playLiveToItsEnd(true, true, true)
  windowOpen = false
  askedPart = { part, end: Date.now() }
  await vi.advanceTimersByTimeAsync(60_000)
  vi.useRealTimers()
  await vi.waitFor(() => expect(calls.some((call) => call.command === 'video_player_upcoming')).toBe(true))
  await settle()
  expect(played()).toBeUndefined()
})

// The compressor's choice for the video's channel, given to the player (controls.js)
const compressorGiven = () => {
  const address = calls.filter((call) => call.command === 'open_video_player').at(-1)!.args.address as string
  return JSON.parse(new URLSearchParams(address.split('?')[1]).get('data')!).compressor
}

test('the compressor: step 1 for a new channel, then what was picked for that channel only', async () => {
  playVideo(video())
  await settle()
  expect(compressorGiven()).toEqual({ on: true, strength: '1' })
  send('video-compressor', { on: false, strength: '6', video: 'youtube-abcdefghijk' })
  send('video-compressor', { on: true, strength: '3', video: 'youtube-another' }) // not the open video: ignored
  send('video-compressor', { on: true, strength: 'loud', video: 'youtube-abcdefghijk' }) // not a strength: ignored
  send('video-compressor', { on: true, strength: '8', video: 'youtube-abcdefghijk' }) // no step 8: ignored
  playVideo(video())
  await settle()
  expect(compressorGiven()).toEqual({ on: false, strength: '6' })
  playVideo({ ...video(), id: 'youtube-otherchannel', channelId: 'd', url: 'https://youtu.be/otherchannel' })
  await settle()
  expect(compressorGiven()).toEqual({ on: true, strength: '1' })
})

test('the compressor: Peaks only and Voice are kept too', async () => {
  playVideo(video())
  await settle()
  send('video-compressor', { on: true, strength: 'voice', video: 'youtube-abcdefghijk' })
  playVideo(video())
  await settle()
  expect(compressorGiven()).toEqual({ on: true, strength: 'voice' })
  send('video-compressor', { on: false, strength: 'peaks', video: 'youtube-abcdefghijk' })
  playVideo(video())
  await settle()
  expect(compressorGiven()).toEqual({ on: false, strength: 'peaks' })
})

test('the compressor: Light, Medium and Strong saved before the 1–7 steps become 1, 3 and 6', async () => {
  store.set('syncr.videoCompressor', { 'youtube c': { on: true, strength: 'medium' }, 'youtube d': { on: false, strength: 'strong' }, 'youtube e': { on: true, strength: 'odd' } })
  playVideo(video())
  await settle()
  expect(compressorGiven()).toEqual({ on: true, strength: '3' })
  playVideo({ ...video(), id: 'youtube-otherchannel', channelId: 'd', url: 'https://youtu.be/otherchannel' })
  await settle()
  expect(compressorGiven()).toEqual({ on: false, strength: '6' })
  playVideo({ ...video(), id: 'youtube-thirdchannl', channelId: 'e', url: 'https://youtu.be/thirdchannl' })
  await settle()
  expect(compressorGiven()).toEqual({ on: true, strength: '1' })
})

test('the compressor: Custom keeps its numbers, also once another strength is picked', async () => {
  playVideo(video())
  await settle()
  send('video-compressor', { on: true, strength: 'custom-12-2-1', video: 'youtube-abcdefghijk' })
  playVideo(video())
  await settle()
  expect(compressorGiven()).toEqual({ on: true, strength: 'custom', custom: { quiet: 12, loud: 2, voice: true } })
  send('video-compressor', { on: true, strength: '5', video: 'youtube-abcdefghijk' }) // its numbers stay for next time
  send('video-compressor', { on: true, strength: 'custom-16-2-1', video: 'youtube-abcdefghijk' }) // over 15: ignored
  send('video-compressor', { on: true, strength: 'custom', video: 'youtube-abcdefghijk' }) // no numbers: ignored
  playVideo(video())
  await settle()
  expect(compressorGiven()).toEqual({ on: true, strength: '5', custom: { quiet: 12, loud: 2, voice: true } })
  send('video-compressor', { on: false, strength: 'custom-0-15-0', video: 'youtube-abcdefghijk' })
  playVideo(video())
  await settle()
  expect(compressorGiven()).toEqual({ on: false, strength: 'custom', custom: { quiet: 0, loud: 15, voice: false } })
})

test('the compressor: Custom saved without valid numbers falls back to step 1', async () => {
  store.set('syncr.videoCompressor', { 'youtube c': { on: true, strength: 'custom', custom: { quiet: 3.5, loud: 2, voice: false } } })
  playVideo(video())
  await settle()
  expect(compressorGiven()).toEqual({ on: true, strength: '1' })
})

test('the compressor: "Use on every channel" shares one choice, each channel keeps its own', async () => {
  const other = { ...video(), id: 'youtube-otherchannel', channelId: 'd', url: 'https://youtu.be/otherchannel' }
  playVideo(video())
  await settle()
  send('video-compressor', { on: true, strength: '4', video: 'youtube-abcdefghijk' }) // this channel's own
  send('video-compressor', { on: true, strength: 'custom-9-3-0', every: true, video: 'youtube-abcdefghijk' }) // ticked
  playVideo(other)
  await settle()
  const shared = { on: true, strength: 'custom', custom: { quiet: 9, loud: 3, voice: false }, every: true }
  expect(compressorGiven()).toEqual({ ...shared, own: { on: true, strength: '1' } })
  send('video-compressor', { on: false, strength: '7', every: true, video: 'youtube-otherchannel' }) // changed while ticked
  playVideo(video())
  await settle()
  expect(compressorGiven()).toEqual({ on: false, strength: '7', custom: { quiet: 9, loud: 3, voice: false }, every: true, own: { on: true, strength: '4' } })
  send('video-compressor', { on: true, strength: '4', every: false, video: 'youtube-abcdefghijk' }) // unticked: its own again
  playVideo(other)
  await settle()
  expect(compressorGiven()).toEqual({ on: true, strength: '1' }) // never set: still step 1
  playVideo(video())
  await settle()
  expect(compressorGiven()).toEqual({ on: true, strength: '4' })
})
