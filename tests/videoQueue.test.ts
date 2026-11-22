import { expect, test, vi } from 'vitest'

// The Queue's order (videoQueue.ts): the last video opened goes first, wherever it was.

const store = new Map<string, unknown>([['syncr.videoQueue', []]])
vi.mock('../src/localState', () => ({
  read: (key: string, fallback: unknown) => (store.has(key) ? structuredClone(store.get(key)) : fallback),
  write: (key: string, value: unknown) => void store.set(key, structuredClone(value)),
}))
vi.mock('../src/videoPositions', () => ({ startedIds: () => [] }))

const { addToQueue, joinedAlone, queueOpened, queueStarted } = await import('../src/videoQueue')
const order = () => (store.get('syncr.videoQueue') as { id: string }[]).map((entry) => entry.id)

test('opened: goes first, also from a spot placed by hand, and keeps how it joined', () => {
  queueStarted('a')
  addToQueue('b')
  addToQueue('c')
  expect(order()).toEqual(['a', 'b', 'c'])
  queueOpened('c')
  expect(order()).toEqual(['c', 'a', 'b'])
  expect(joinedAlone('c')).toBe(false)
  queueOpened('a')
  expect(order()).toEqual(['a', 'c', 'b'])
  expect(joinedAlone('a')).toBe(true)
})

test('opened, not in the Queue yet: joins first, as joined alone', () => {
  queueOpened('d')
  expect(order()[0]).toBe('d')
  expect(joinedAlone('d')).toBe(true)
  expect(order().filter((id) => id === 'd')).toHaveLength(1)
})
