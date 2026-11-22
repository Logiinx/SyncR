import { expect, test, vi } from 'vitest'
import type { VideoFollow, VideoRow } from '../src/db'

vi.mock('../src/db', () => ({ db: {} }))
const { videosToSave } = await import('../src/mutedSound')

const HOUR = 60 * 60 * 1000
const now = 1_000 * HOUR
const follow = (channelId: string, more: Partial<VideoFollow> = {}) =>
  ({ id: channelId, platform: 'twitch', channelId, saveMuted: true, deleted: false, ...more }) as VideoFollow
// A stream of 2 h that ended `endedAgo` hours ago
const video = (id: string, channelId: string, endedAgo: number, more: Partial<VideoRow> = {}) =>
  ({ id: `twitch-${id}`, platform: 'twitch', channelId, published: now - (endedAgo + 2) * HOUR, duration: 2 * 60 * 60, gone: false, ...more }) as VideoRow

test('only finished streams of channels with the option on, for 48 h', () => {
  const follows = [follow('on'), follow('off', { saveMuted: false }), follow('old', { saveMuted: undefined }), follow('removed', { deleted: true })]
  const videos = [
    video('1', 'on', 1),
    video('2', 'on', 47.9),
    video('3', 'on', 48.1), // too late
    video('4', 'on', 0, { live: true }), // still streaming
    video('5', 'on', 1, { gone: true }),
    video('6', 'off', 1),
    video('7', 'old', 1),
    video('8', 'removed', 1),
    video('9', 'other', 1),
    { ...video('10', 'on', 1), id: 'youtube-10', platform: 'youtube' } as VideoRow,
  ]
  expect(videosToSave(follows, videos, now)).toEqual(['1', '2'])
})

test('a YouTube follow with the same channel id never counts', () => {
  expect(videosToSave([follow('x', { platform: 'youtube' })], [video('1', 'x', 1)], now)).toEqual([])
})
