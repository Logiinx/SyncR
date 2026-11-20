import { expect, test, vi } from 'vitest'
import fc from 'fast-check'

// The play order of Not started (playOrder.ts): after any move, saving what orderChanges says and
// sorting again must give exactly the order the user made, whatever places the games had before.

vi.mock('../src/db', () => ({ db: {}, changed: () => {} }))
vi.mock('../src/appearance', () => ({ currentZoom: () => 1 }))
vi.mock('../src/animations', () => ({ animationsOn: () => false, EASE_OPEN: '', TIMING: {} }))

const { moveItem, orderChanges, sortPlayOrder } = await import('../src/playOrder')
type Game = import('../src/db').Game

const game = (id: string, statusAt: number, playOrder?: number, playOrderAt?: number) =>
  ({ id, statusAt, playOrder, playOrderAt }) as Game

test('games without a place: oldest arrival first; placed ones before them', () => {
  const list = [game('new', 30), game('old', 10), game('placed', 20, 5, 20), game('stale', 25, 1, 3)]
  expect(sortPlayOrder(list).map((g) => g.id)).toEqual(['placed', 'old', 'stale', 'new'])
})

test('a move, saved and sorted again, gives the order the user made', () => {
  const games = fc.array(
    fc.record({
      statusAt: fc.integer({ min: 1, max: 50 }),
      placed: fc.boolean(),
      stale: fc.boolean(),
      order: fc.double({ min: -100, max: 100, noNaN: true }),
    }),
    { minLength: 1, maxLength: 12 },
  )
  fc.assert(
    fc.property(games, fc.nat(), fc.nat(), fc.integer({ min: 1, max: 4 }), (specs, a, b, rounds) => {
      let list = specs.map((s, i) =>
        game(`g${i}`, s.statusAt, s.placed ? s.order : undefined, s.placed ? (s.stale ? s.statusAt - 1 : s.statusAt) : undefined),
      )
      // Several moves in a row (each one saved), like a user dragging a few games
      for (let round = 0; round < rounds; round++) {
        const shown = sortPlayOrder(list)
        const from = (a + round) % shown.length
        const to = (b * (round + 1)) % shown.length
        const wanted = moveItem(shown, from, to)
        const changes = new Map(orderChanges(wanted, shown[from].id).map((c) => [c.id, c]))
        list = list.map((g) => ({ ...g, ...changes.get(g.id) }))
        expect(sortPlayOrder(list).map((g) => g.id)).toEqual(wanted.map((g) => g.id))
      }
    }),
  )
})

test('neighbours too close: numbered again 1, 2, 3, in the order made', () => {
  const list = [game('a', 1, 1, 1), game('b', 2, 1 + 1e-9, 2), game('c', 3, 2, 3)]
  const wanted = moveItem(list, 2, 1) // c between a and b
  const changes = new Map(orderChanges(wanted, 'c').map((c) => [c.id, c]))
  const saved = list.map((g) => ({ ...g, ...changes.get(g.id) }))
  expect(saved.map((g) => g.playOrder)).toEqual([1, 3, 2])
})
