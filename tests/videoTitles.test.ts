import 'fake-indexeddb/auto' // an in-memory database in place of the browser's (first, before Dexie loads)
import { beforeEach, expect, test, vi } from 'vitest'

// DeArrow's better titles (videoTitles.ts checkTitles): each save redraws the Video tab, so a big
// first run must not save every few videos. Answers without a new title wait for the end.

vi.mock('../src/i18n', () => ({ t: (text: string) => text }))
vi.mock('../src/localState', () => ({ read: (_key: string, fallback: unknown) => fallback, write: () => {} }))

// DeArrow: every video has a better title when withTitles, none otherwise
let withTitles = false
globalThis.fetch = (async () => {
  if (!withTitles) return new Response('', { status: 404 })
  const answer = Object.fromEntries(videos.map((video) => [video.id.slice('youtube-'.length), { titles: [{ title: `Better ${video.id}`, original: false, votes: 1, locked: false }] }]))
  return new Response(JSON.stringify(answer), { status: 200 })
}) as typeof fetch

const videos = Array.from({ length: 60 }, (_, i) => ({ id: `youtube-v${i}`, title: `Video ${i}` }))

const { db } = await import('../src/db')
const { checkTitles } = await import('../src/videoTitles')

let saves = 0
beforeEach(async () => {
  await db.videoTitles.clear()
  saves = 0
})
const bulkPut = db.videoTitles.bulkPut.bind(db.videoTitles)
db.videoTitles.bulkPut = ((...args: Parameters<typeof bulkPut>) => {
  saves++
  return bulkPut(...args)
}) as typeof bulkPut

test('no new titles: one save at the end', async () => {
  withTitles = false
  await checkTitles(videos)
  expect(saves).toBe(1)
  expect(await db.videoTitles.count()).toBe(60)
})

test('new titles: the first saved at once, the rest at the end of a quick run', async () => {
  withTitles = true
  await checkTitles(videos)
  expect(saves).toBe(2)
  expect((await db.videoTitles.get('youtube-v59'))?.title).toBe('Better youtube-v59')
})
