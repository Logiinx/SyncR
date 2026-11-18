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
vi.mock('../src/video', () => ({ markOpened: async () => {}, setWatched: async () => {}, watchWatched: () => () => {} }))
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

const video = (watched = false) => ({ id: 'youtube-abcdefghijk', platform: 'youtube' as const, title: 'A video', channelId: 'c', url: 'https://youtu.be/abcdefghijk', watched, duration: 3600 })
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const send = (name: string, payload: unknown) => handlers.get(name)!({ payload })

beforeEach(() => {
  store.clear()
  calls.length = 0
  queued.length = 0
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
