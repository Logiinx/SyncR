import 'fake-indexeddb/auto' // an in-memory database in place of the browser's (first, before Dexie loads)
import { beforeEach, expect, test, vi } from 'vitest'

// The price alert check (priceWatch.ts checkWatches) with fake prices: it must only mark the
// watch it checked, and editions that can't be looked up must not hold back the game's own alert.

vi.mock('../src/i18n', () => ({ t: (text: string) => text }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }))
vi.mock('../src/igdb', () => ({ loadConnection: async () => ({ url: 'x', password: 'x' }), isComplete: () => true }))
vi.mock('../src/google', () => ({ isConnected: () => false }))
vi.mock('../src/calendarEvents', () => ({ savePriceAlertEvent: async () => {} }))
vi.mock('../src/games', () => ({ gameId: (igdbId: number) => `igdb-${igdbId}` }))

// Steam at 5 €; beforeLookup runs while the lookup "waits for the network"
let beforeLookup: () => Promise<void> = async () => {}
vi.mock('../src/prices', () => ({
  formatEuros: (cents: number) => `${cents / 100} €`,
  lookupsAsked: () => 0,
  gamePrices: async (ids: number[]) => {
    await beforeLookup()
    return new Map(ids.map((id) => [id, { steamUrl: '', steam: { final: 500, initial: 1000, discount: 50 }, deals: null }]))
  },
}))
let editionsFail = false
vi.mock('../src/editions', () => ({
  gameEditions: async () => {
    if (editionsFail) throw new Error('proxy down')
    return new Map()
  },
}))

;(globalThis as { window?: EventTarget }).window ??= new EventTarget() // changed() sends an event

const { db, setGameStatus, updateGame } = await import('../src/db')
const { checkWatches } = await import('../src/priceWatch')
type Game = Parameters<typeof db.games.put>[0]

const ID = 'igdb-1'
const game = (change: Partial<Game> = {}): Game => ({
  id: ID, igdbId: 1, name: 'Test', platforms: [], status: 'tobuy', note: '', review: '', liked: false, priority: false,
  createdAt: 1, statusAt: 1, updatedAt: 1, deleted: false, watch: { when: 'price', target: 1000, setAt: 1 }, ...change,
} as Game)

beforeEach(async () => {
  await db.games.clear()
  beforeLookup = async () => {}
  editionsFail = false
})

test('a reached price marks the watch', async () => {
  await db.games.put(game())
  expect(await checkWatches()).toBe(true)
  const watch = (await db.games.get(ID))!.watch!
  expect(watch.firedPrice).toBe(500)
  expect(watch.target).toBe(1000)
})

test('a watch changed during the lookup is kept as changed', async () => {
  await db.games.put(game())
  beforeLookup = () => updateGame(ID, { watch: { when: 'price', target: 300, setAt: 2 } })
  await checkWatches()
  expect((await db.games.get(ID))!.watch).toEqual({ when: 'price', target: 300, setAt: 2 })
})

test('a watch dropped during the lookup (moved to Not started) stays gone', async () => {
  await db.games.put(game())
  beforeLookup = () => setGameStatus(ID, 'upnext')
  await checkWatches()
  expect((await db.games.get(ID))!.watch).toBeUndefined()
})

test('editions failing still lets the game alert, and the check counts as failed', async () => {
  await db.games.put(game({ editionWatches: [{ kind: 'sub', id: 7, name: 'Deluxe', when: 'low', setAt: 1 }] }))
  editionsFail = true
  expect(await checkWatches()).toBe(false)
  expect((await db.games.get(ID))!.watch!.firedPrice).toBe(500)
})
