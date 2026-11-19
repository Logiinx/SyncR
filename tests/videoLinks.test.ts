import { beforeEach, expect, test, vi } from 'vitest'

// A note's video link (videoLinks.ts): which links count, and that it plays in the player only
// where the Video tab shows, falling back to the browser.

const opened: string[] = []
const played: { id: string; playlistId?: string; start?: number }[] = []
let enabled = true
let lookup: () => Promise<{ video: { id: string }; playlistId?: string }>
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }))
vi.mock('../src/links', () => ({ openLink: (href: string) => void opened.push(href) }))
vi.mock('../src/localState', () => ({ read: (key: string, fallback: unknown) => (key === 'syncr.videoFeed' ? enabled : fallback) }))
vi.mock('../src/video', () => ({ findVideo: () => lookup(), markOpened: async () => {} }))
vi.mock('../src/videoPlayer', () => ({
  playVideo: (video: { id: string }, playlistId?: string, start?: number) => void played.push({ id: video.id, playlistId, start }),
}))
vi.mock('../src/videoPaste', () => ({ linkTime: (url: URL) => Number(url.searchParams.get('t') ?? 0) }))

const { isVideoLink, openLinkOrPlay, playsHere } = await import('../src/videoLinks')

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  opened.length = 0
  played.length = 0
  enabled = true
  lookup = async () => ({ video: { id: 'youtube-abc123def45' } })
})

test('video links count, others not', () => {
  for (const href of [
    'https://www.youtube.com/watch?v=abc123def45',
    'https://m.youtube.com/watch?v=abc123def45&t=90',
    'https://youtube.com/watch?v=abc123def45&list=PL123',
    'https://www.youtube.com/shorts/abc123def45',
    'https://www.youtube.com/live/abc123def45',
    'https://youtu.be/abc123def45?t=1m2s',
    'http://youtu.be/abc123def45',
    'https://www.twitch.tv/videos/123456789',
  ]) expect(isVideoLink(href), href).toBe(true)
  for (const href of [
    'https://www.youtube.com/',
    'https://www.youtube.com/watch',
    'https://www.youtube.com/playlist?list=PL123',
    'https://www.youtube.com/@channel',
    'https://www.youtube.com/channel/UC123',
    'https://www.twitch.tv/somechannel',
    'https://clips.twitch.tv/SomeClip',
    'https://example.com/watch?v=abc123def45',
    'https://notyoutube.com/watch?v=abc123def45',
    'javascript:alert(1)',
    'not a link',
  ]) expect(isVideoLink(href), href).toBe(false)
})

test('a video link plays in the player, from its time', async () => {
  openLinkOrPlay('https://www.youtube.com/watch?v=abc123def45&t=90')
  await settle()
  expect(played).toEqual([{ id: 'youtube-abc123def45', playlistId: undefined, start: 90 }])
  expect(opened).toEqual([])
})

test('in a playlist: plays in it', async () => {
  lookup = async () => ({ video: { id: 'youtube-abc123def45' }, playlistId: 'pl-1' })
  openLinkOrPlay('https://youtu.be/abc123def45')
  await settle()
  expect(played).toEqual([{ id: 'youtube-abc123def45', playlistId: 'pl-1', start: 0 }])
})

test('without the Video tab: the browser', async () => {
  enabled = false
  expect(playsHere('https://youtu.be/abc123def45')).toBe(false)
  openLinkOrPlay('https://youtu.be/abc123def45')
  await settle()
  expect(opened).toEqual(['https://youtu.be/abc123def45'])
  expect(played).toEqual([])
})

test('other links and failed lookups: the browser', async () => {
  openLinkOrPlay('https://www.youtube.com/@channel')
  lookup = async () => Promise.reject(new Error('gone'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  openLinkOrPlay('https://youtu.be/abc123def45')
  await settle()
  expect(opened).toEqual(['https://www.youtube.com/@channel', 'https://youtu.be/abc123def45'])
  expect(played).toEqual([])
})
