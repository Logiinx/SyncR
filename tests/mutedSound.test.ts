import { expect, test, vi } from 'vitest'
import type { AddedVideo, VideoFollow, VideoMark, VideoRow } from '../src/db'

// A stand-in mark id: the test only needs it to match the video's
vi.mock('../src/db', () => ({ db: {}, alertMarkId: (key: string) => `mark-${key}` }))
const { soundKept, videosToSave } = await import('../src/mutedSound')

const HOUR = 60 * 60 * 1000
const now = 1_000 * HOUR
const follow = (channelId: string, more: Partial<VideoFollow> = {}) =>
  ({ id: channelId, platform: 'twitch', channelId, saveMuted: true, deleted: false, ...more }) as VideoFollow
// A stream of 2 h that ended `endedAgo` hours ago
const video = (id: string, channelId: string, endedAgo: number, more: Partial<VideoRow> = {}) =>
  ({ id: `twitch-${id}`, platform: 'twitch', channelId, published: now - (endedAgo + 2) * HOUR, duration: 2 * 60 * 60, gone: false, title: id, ...more }) as VideoRow
const all = (ids: string[]) => new Set(ids)

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
  expect(videosToSave(follows, videos, all(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']), now)).toEqual(['1', '2'])
})

test('a stream no longer in the Video list is never saved', () => {
  expect(videosToSave([follow('on')], [video('1', 'on', 1), video('2', 'on', 1)], all(['2']), now)).toEqual(['2'])
})

test('a YouTube follow with the same channel id never counts', () => {
  expect(videosToSave([follow('x', { platform: 'youtube' })], [video('1', 'x', 1)], all(['1']), now)).toEqual([])
})

test('sound is kept for the Twitch videos still in the Video list', () => {
  const follows = [follow('a'), follow('removed', { deleted: true }), follow('yt', { platform: 'youtube' })]
  const videos = [
    video('1', 'a', 1),
    video('2', 'a', 100), // older, still listed: kept (the option and the 48 h don't matter here)
    video('3', 'a', 1, { title: 'hidden' }), // the follow's filters hide it
    video('4', 'a', 1, { gone: true }), // deleted by Twitch
    video('5', 'a', 1), // cleared from Watched
    video('6', 'removed', 1),
    video('7', 'yt', 1),
    video('8', 'nobody', 1),
  ]
  const added = [
    { id: 'm9', videoId: 'twitch-9', platform: 'twitch', channelId: 'nobody', gone: false },
    { id: 'm10', videoId: 'twitch-10', platform: 'twitch', channelId: 'nobody', gone: true },
    { id: 'm11', videoId: 'twitch-1', platform: 'twitch', channelId: 'a', gone: false }, // also a follow's row: once
    { id: 'm12', videoId: 'youtube-12', platform: 'youtube', channelId: 'x', gone: false },
  ] as AddedVideo[]
  const marks = [{ id: 'mark-twitch-5', cleared: true }, { id: 'mark-twitch-2', watched: true }] as VideoMark[]
  expect(soundKept(follows, videos, added, marks, (_, row) => row.title !== 'hidden')).toEqual(['1', '2', '9'])
})
