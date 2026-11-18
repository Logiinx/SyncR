import { expect, test, vi } from 'vitest'

// "Twitch deletes it in N days" (dates.ts): rounded down, so it warns early, never late; hours on
// its last day.

vi.mock('../src/i18n', () => ({
  t: (text: string, values?: Record<string, unknown>) => text.replace('{n}', String(values?.n)),
  plural: (n: number, one: string, other: string) => (n === 1 ? one : other).replace('{n}', String(n)),
  capitalize: (text: string) => text,
  currentLanguage: () => 'en',
  locale: () => 'en',
}))

const { twitchDeletionText } = await import('../src/dates')

const HOUR = 3_600_000
const started = (hoursAgo: number) => Date.now() - hoursAgo * HOUR

test('days, rounded down', () => {
  expect(twitchDeletionText(started(48.5), 60)).toBe('Twitch deletes it in 57 days')
  expect(twitchDeletionText(started(6.5 * 24), 14)).toBe('Twitch deletes it in 7 days')
  expect(twitchDeletionText(started(6 * 24 - 1), 7)).toBe('Twitch deletes it in 1 day')
})

test('hours on its last day, then less than an hour', () => {
  expect(twitchDeletionText(started(7 * 24 - 12.5), 7)).toBe('Twitch deletes it in 12 hours')
  expect(twitchDeletionText(started(7 * 24 - 1.5), 7)).toBe('Twitch deletes it in 1 hour')
  expect(twitchDeletionText(started(7 * 24 - 0.5), 7)).toBe('Twitch deletes it in less than an hour')
  expect(twitchDeletionText(started(7 * 24 + 3), 7)).toBe('Twitch deletes it in less than an hour') // not deleted yet
})
