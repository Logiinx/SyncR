import 'fake-indexeddb/auto' // an in-memory database in place of the browser's (first, before Dexie loads)
import { beforeEach, expect, test, vi } from 'vitest'

// The Video tab's check of a followed channel (video.ts checkVideos) with a fake Worker and a fake
// Twitch website: a Twitch follow with "only these games" and the bell must get a pop-up card for a
// new video of that game, and Twitch's website failing must not fail the follow.

vi.mock('../src/i18n', () => ({ t: (text: string) => text }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false })) // the pop-up's cards also come in dev (import.meta.env.DEV)
const store = new Map<string, unknown>()
vi.mock('../src/localState', () => ({
  read: (key: string, fallback: unknown) => (store.has(key) ? structuredClone(store.get(key)) : fallback),
  write: (key: string, value: unknown) => void store.set(key, structuredClone(value)),
  useLocalState: () => [false, () => {}],
}))
const alerted: string[][] = []
vi.mock('../src/videoAlerts', () => ({ addVideoAlerts: (ids: string[]) => void alerted.push(ids), removeVideoAlerts: () => {} }))

// What the Worker lists for the channel now
let listed: { id: string; title: string; live?: boolean }[] = []
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
vi.mock('../src/igdb', () => ({
  isComplete: () => true,
  useConnection: () => null,
  igdbProxyFetch: async (endpoint: string, body: string) => {
    if (endpoint === 'video/list') {
      return json({ videos: listed.map((video) => ({ kind: 'archive', url: '', thumbnail: null, published: new Date().toISOString(), duration: 3600, live: false, ...video })) })
    }
    if (endpoint === 'video/exists') return json({ existing: JSON.parse(body).ids })
    return new Response('{}', { status: 404 })
  },
}))

// Twitch's website: every video plays Elden Ring, or it fails
let twitchFails = false
globalThis.fetch = (async () => {
  if (twitchFails) return new Response('', { status: 500 })
  const edges = listed.map((video) => ({ cursor: video.id, node: { id: video.id, game: { name: 'Elden Ring', displayName: 'Elden Ring' }, moments: null } }))
  return json({ data: { user: { videos: { pageInfo: { hasNextPage: false }, edges } } } })
}) as typeof fetch

;(globalThis as { window?: EventTarget }).window ??= new EventTarget() // changed() sends an event

const { db } = await import('../src/db')
const { checkVideos } = await import('../src/video')

const FOLLOW = 'follow-1'

beforeEach(async () => {
  await Promise.all([db.videoFollows.clear(), db.videos.clear()])
  store.clear()
  alerted.length = 0
  twitchFails = false
  listed = [{ id: '1', title: 'Old stream' }]
  await db.videoFollows.put({
    id: FOLLOW, platform: 'twitch', channelId: '42', name: 'Streamer', icon: null, startAt: 0, deleted: false, updatedAt: 1,
    onlyWords: [], exceptWords: [], onlyGames: ['elden ring'], minMinutes: 0, hideShorts: false, music: false, notify: true,
  })
  await checkVideos() // its first check: what was there already, no cards
})

test('a new video of a chosen game gets its pop-up card', async () => {
  listed = [{ id: '2', title: 'New stream' }, ...listed]
  await checkVideos()
  expect(alerted).toEqual([['twitch-2']])
})

test('a stream still live is listed with its live mark, which goes once it’s over', async () => {
  listed = [{ id: '2', title: 'Subathon', live: true }, ...listed]
  await checkVideos()
  expect((await db.videos.get('twitch-2'))?.live).toBe(true)
  listed = [{ id: '2', title: 'Subathon' }, ...listed.slice(1)]
  await checkVideos()
  expect((await db.videos.get('twitch-2'))?.live).toBeUndefined()
})

test("Twitch's website failing leaves the games for later, not the follow failed", async () => {
  twitchFails = true
  listed = [{ id: '2', title: 'New stream' }, ...listed]
  const before = (store.get('syncr.videoChecked') as Record<string, number>)[FOLLOW]
  await new Promise((resolve) => setTimeout(resolve, 5))
  await checkVideos()
  expect((store.get('syncr.videoChecked') as Record<string, number>)[FOLLOW]).toBeGreaterThan(before)
  expect((await db.videos.get('twitch-2'))?.games).toBeUndefined() // asked again next check
})
