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
let listed: { id: string; title: string; live?: boolean; duration?: number }[] = []
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

// Twitch's website: every video plays Elden Ring (or its game in playing), or it fails
let twitchFails = false
const playing = new Map<string, string>()
globalThis.fetch = (async () => {
  if (twitchFails) return new Response('', { status: 500 })
  const edges = listed.map((video) => {
    const name = playing.get(video.id) ?? 'Elden Ring'
    return { cursor: video.id, node: { id: video.id, game: { name, displayName: name }, moments: null } }
  })
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
  playing.clear()
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

test('a live stream’s games are read again while live and once after its end, then no more', async () => {
  const games = async () => (await db.videos.get('twitch-2'))?.games?.map((game) => game.name)
  playing.set('2', 'Just Chatting')
  listed = [{ id: '2', title: 'Subathon', live: true }, ...listed]
  await checkVideos()
  expect(await games()).toEqual(['Just Chatting'])
  playing.set('2', 'Elden Ring') // changed game while live
  await checkVideos()
  expect(await games()).toEqual(['Elden Ring'])
  playing.set('2', 'Hades') // changed in its last minutes: read right after the end
  listed = [{ id: '2', title: 'Subathon' }, ...listed.slice(1)]
  await checkVideos()
  expect(await games()).toEqual(['Hades'])
  playing.set('2', 'Celeste') // over: not read again
  await checkVideos()
  expect(await games()).toEqual(['Hades'])
})

test('games read again but unchanged are not saved again (every save redraws the list)', async () => {
  listed = [{ id: '2', title: 'Subathon', live: true }, ...listed]
  await checkVideos()
  let saves = 0
  const count = () => void saves++
  db.videos.hook('updating', count)
  await checkVideos()
  db.videos.hook('updating').unsubscribe(count)
  expect(saves).toBe(0)
})

test('a live stream that only later plays a chosen game gets its pop-up card then, once', async () => {
  playing.set('2', 'Just Chatting')
  listed = [{ id: '2', title: 'Subathon', live: true }, ...listed]
  await checkVideos()
  expect(alerted).toEqual([])
  playing.set('2', 'Elden Ring')
  await checkVideos()
  expect(alerted).toEqual([['twitch-2']])
  await checkVideos()
  expect(alerted).toEqual([['twitch-2']])
})

test('a live stream too short at first gets its pop-up card once long enough; an ended one never', async () => {
  await db.videoFollows.update(FOLLOW, { minMinutes: 60 })
  listed = [{ id: '2', title: 'Subathon', live: true, duration: 600 }, { id: '3', title: 'Short one', duration: 600 }, ...listed]
  await checkVideos()
  expect(alerted).toEqual([])
  listed = [{ id: '2', title: 'Subathon', live: true, duration: 5400 }, ...listed.slice(1)]
  await checkVideos()
  expect(alerted).toEqual([['twitch-2']])
})
