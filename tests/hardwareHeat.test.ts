import { expect, test, vi } from 'vitest'
import fc from 'fast-check'

// The Hardware widget's hot colors (hardware.ts): a temperature turns orange (1) at its first limit,
// red (2) at its second, and only goes back down 2 °C under that limit (no blinking at the edge).

vi.mock('../src/localState', () => ({ read: (_key: string, fallback: unknown) => fallback, write: () => {} }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: async () => {} }))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
vi.mock('../src/i18n', () => ({ t: (text: string) => text, decimal: String, percentText: (n: number) => `${n}%` })) // the real one needs a page
vi.mock('../src/animations', () => ({ animationsOn: () => true })) // needs a page too

const { nextHeat } = await import('../src/hardware')
const limits: [number, number] = [75, 85]

test('goes up as soon as a limit is reached', () => {
  expect(nextHeat(0, 74.9, limits)).toBe(0)
  expect(nextHeat(0, 75, limits)).toBe(1)
  expect(nextHeat(0, 85, limits)).toBe(2)
  expect(nextHeat(1, 90, limits)).toBe(2)
})

test('goes back down only 2 °C under the limit', () => {
  expect(nextHeat(2, 84, limits)).toBe(2)
  expect(nextHeat(2, 83.1, limits)).toBe(2)
  expect(nextHeat(2, 83, limits)).toBe(1)
  expect(nextHeat(1, 74, limits)).toBe(1)
  expect(nextHeat(1, 73, limits)).toBe(0)
  expect(nextHeat(2, 60, limits)).toBe(0) // a big drop at once
  expect(nextHeat(2, 74, limits)).toBe(1) // under red's margin, inside orange's
})

test('a reading at the edge never blinks', () => {
  let level = 0
  const seen = [84.6, 85, 84.2, 85.1, 84, 83.5, 85].map((celsius) => (level = nextHeat(level, celsius, limits)))
  expect(seen).toEqual([1, 2, 2, 2, 2, 2, 2])
})

test('the same reading twice gives the same color (a changed limit recomputes it)', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 2 }), fc.double({ min: 0, max: 120, noNaN: true }), (before, celsius) => {
      const once = nextHeat(before, celsius, limits)
      expect(nextHeat(once, celsius, limits)).toBe(once)
    }),
  )
})

test('red below orange: red wins', () => {
  expect(nextHeat(0, 82, [90, 80])).toBe(2)
  expect(nextHeat(2, 79, [90, 80])).toBe(2)
  expect(nextHeat(2, 78, [90, 80])).toBe(0)
})
