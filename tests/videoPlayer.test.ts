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
vi.mock('../src/video', () => ({ markOpened: async () => {}, setWatched: async (id: string) => void watchedSet.push(id), watchWatched: () => () => {} }))
vi.mock('../src/videoPlaylists', () => ({ nextInPlaylist: async () => null }))
const queued: string[] = []
vi.mock('../src/videoQueue', () => ({ queueStarted: (id: string) => void queued.push(id) }))
const calls: { command: string; args: Record<string, unknown> }[] = []
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: async (command: string, args: Record<string, unknown>) => void calls.push({ command, args }),
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
async function playLiveToItsEnd(finished: boolean) {
  const live = { id: 'twitch-123', platform: 'twitch' as const, title: 'Subathon', channelId: 'c', url: 'https://www.twitch.tv/videos/123', watched: false, duration: 3600, live: true }
  playVideo(live)
  await settle()
  vi.useFakeTimers({ now: Date.now() + 4000, toFake: ['Date'] })
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
  expect(calls.some((call) => call.command === 'close_video_player')).toBe(true)
})
