import { expect, test, vi } from 'vitest'

// The Hardware widget's size (hardware.ts): Ctrl + mouse wheel goes one size up or down.

vi.mock('../src/localState', () => ({ read: (_key: string, fallback: unknown) => fallback, write: () => {} }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: async () => {} }))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))
vi.mock('../src/i18n', () => ({ t: (text: string) => text, decimal: String, percentText: (n: number) => `${n}%` })) // the real one needs a page

const { nextSize } = await import('../src/hardware')

test('one size up or down', () => {
  expect(nextSize(100, 1)).toBe(110)
  expect(nextSize(100, -1)).toBe(90)
  expect(nextSize(110, 1)).toBe(125)
})

test('stops at the ends', () => {
  expect(nextSize(150, 1)).toBe(150)
  expect(nextSize(80, -1)).toBe(80)
})

test('a size not in the list goes to its neighbour', () => {
  expect(nextSize(95, 1)).toBe(100)
  expect(nextSize(95, -1)).toBe(90)
  expect(nextSize(300, -1)).toBe(150)
  expect(nextSize(10, 1)).toBe(80)
})
