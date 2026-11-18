import { expect, test, vi } from 'vitest'

// A Twitch stream's next part (videoParts.ts): the channel's next past stream, started up to
// 30 min after this one's end.

vi.mock('../src/db', () => ({ alertMarkId: (id: string) => id, db: {} }))
vi.mock('../src/igdb', () => ({ igdbProxyFetch: async () => new Response('{}') }))

const { pickNextPart } = await import('../src/videoParts')

const HOUR = 3_600_000
const start = Date.parse('2026-11-01T00:00:00Z')
const video = (id: string, hoursIn: number, hours = 48, kind = 'archive') => ({ id, kind, published: start + hoursIn * HOUR, duration: hours * 3600 })
const part1 = video('1', 0)

test('the restart a few minutes after its end is its next part', () => {
  expect(pickNextPart([video('2', 48.05), part1], part1)?.id).toBe('2')
})

test('the earliest one wins, whatever the order', () => {
  expect(pickNextPart([video('3', 48.4), video('2', 48.1), part1], part1)?.id).toBe('2')
})

test('another day’s stream is not a part', () => {
  expect(pickNextPart([video('2', 60), part1], part1)).toBeNull()
})

test('highlights, uploads and older videos are not parts', () => {
  expect(pickNextPart([video('h', 48.1, 1, 'highlight'), video('u', 48.1, 1, 'upload'), video('0', -48.1)], part1)).toBeNull()
})

test('the player’s length counts when the saved one is from hours ago (still live then)', () => {
  const saved = { ...part1, duration: 10 * 3600 }
  expect(pickNextPart([video('2', 48.1)], saved)).toBeNull()
  expect(pickNextPart([video('2', 48.1)], saved, 48 * 3600)?.id).toBe('2')
})
