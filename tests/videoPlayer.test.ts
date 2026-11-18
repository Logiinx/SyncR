import { beforeEach, expect, test, vi } from 'vitest'

// The player window's side in the app (videoPlayer.ts), with fake window messages: opening a video
// another way goes on from where it is, and a watched video played again stays out of the Queue.

vi.mock('../src/i18n', () => ({ t: (text: string) => text, locale: () => 'en' }))
vi.mock('../src/animations', () => ({ animationsOn: () => true }))
vi.mock('../src/appearance', () => ({ currentZoom: () => 1 }))
vi.mock('../src/links', () => ({ openLink: () => {} }))
const store = new Map<string, unknown>()
vi.mock('../src/localState', () => ({
  read: (key: string, fallback: unknown) => (store.has(key) ? structuredClone(store.get(key)) : fallback),
  write: (key: string, value: unknown) => void store.set(key, structuredClone(value)),
}))
const watchedSet: string[] = []
// A Twitch stream's next part (videoParts.ts): on this device, and Twitch's answer
const part = { id: 'twitch-456', platform: 'twitch' as const, title: 'Subathon, part 2', channelId: 'c', url: 'https://www.twitch.tv/videos/456', thumbnail: null, watched: false, duration: 7200, live: true }
let knownPart: typeof part | null = null
let askedPart: { part: typeof part | null; end: number | null } = { part: null, end: 0 }
vi.mock('../src/videoParts', () => ({ PART_GAP: 30 * 60_000, knownNextPart: async () => knownPart, askNextPart: async () => askedPart }))
vi.mock('../src/video', () => ({
  addOrFindVideo: async () => ({ video: { ...part, thumbnail: undefined } }),
  markOpened: async () => {},
  setWatched: async (id: string) => void watchedSet.push(id),
  watchWatched: () => () => {},
  followOfChannel: () => undefined,
  loadFollowsNow: async () => {},
  setFollowStartSkip: async () => {},
}))
vi.mock('../src/videoPlaylists', () => ({ nextInPlaylist: async () => null }))
const queued: string[] = []
vi.mock('../src/videoQueue', () => ({ queueStarted: (id: string) => void queued.push(id) }))
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
