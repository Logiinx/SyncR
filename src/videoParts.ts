import { alertMarkId, db, type VideoRow } from './db'
import { igdbProxyFetch } from './igdb'

// A Twitch broadcast lasts 48 h at most, so a long stream (user: a weeks-long subathon) is saved as
// several past streams, one per restart: its parts. When one ends, the next part plays on
// (videoPlayer.ts). The next part: the channel's next past stream, started at most 30 min after
// this one's end (a restart, not another day's stream).
export const PART_GAP = 30 * 60_000

// What the player needs to play it (videoPlayer.ts's PlayableVideo)
export interface Part {
  id: string
  platform: 'twitch'
  title: string
  channelId: string
  url: string
  thumbnail: string | null
  watched: boolean
  duration: number
  live: boolean
}

interface Timed {
  id: string
  kind: string
  published: number
  duration: number
}

// When it ended: from its start and its length. length: the player's, which grows while it's live
// (the saved one can be from hours ago).
export const partEnd = (video: Timed, length = 0) => video.published + Math.max(video.duration, length) * 1000

// The earliest of these that started after this one, within the gap after its end. Only past
// streams (archive): a highlight or upload isn't a part.
export function pickNextPart<T extends Timed>(videos: T[], video: Timed, length = 0): T | null {
  const end = partEnd(video, length)
  let found: T | null = null
  for (const other of videos) {
    if (other.id === video.id || other.kind !== 'archive' || other.published <= video.published || other.published > end + PART_GAP) continue
    if (!found || other.published < found.published) found = other
  }
  return found
}

const asPart = (video: Pick<VideoRow, 'id' | 'title' | 'url' | 'thumbnail' | 'duration' | 'live'>, channelId: string): Part => ({
  id: video.id,
  platform: 'twitch',
  title: video.title,
  channelId,
  url: video.url,
  thumbnail: video.thumbnail,
  watched: false, // the real mark is read when it plays (addOrFindVideo)
  duration: video.duration,
  live: !!video.live,
})

// This video as this device knows it: from a follow's check, or added by its link
async function knownVideo(videoId: string): Promise<Timed | undefined> {
  return (await db.videos.get(videoId)) ?? (await db.addedVideos.get(alertMarkId(videoId)).then((added) => added && { ...added, id: added.videoId }))
}

// From what this device already has (a followed channel's checks): no request, so it can run each
// time a video opens (for ⏭). length: see partEnd.
export async function knownNextPart(video: { id: string; platform: string; channelId: string }, length = 0): Promise<Part | null> {
  if (video.platform !== 'twitch') return null
  const self = await knownVideo(video.id)
  if (!self) return null
  const [rows, added] = await Promise.all([
    db.videos.filter((row) => row.platform === 'twitch' && row.channelId === video.channelId && row.published > self.published && !row.gone).toArray(),
    db.addedVideos.filter((row) => row.platform === 'twitch' && row.channelId === video.channelId && row.published > self.published && !row.gone).toArray(),
  ])
  const found = pickNextPart([...rows, ...added.map((row) => ({ ...row, id: row.videoId }))], self, length)
  return found && asPart(found, video.channelId)
}

// Asks Twitch (through our Worker) for the channel's videos since this one started. Also gives back
// when this one ended (null: Twitch no longer has it), to know whether a part can still come.
export async function askNextPart(video: { id: string; platform: string; channelId: string }, length = 0): Promise<{ part: Part | null; end: number | null }> {
  if (video.platform !== 'twitch') return { part: null, end: null }
  const self = await knownVideo(video.id)
  // Not in this device's list (opened some other way): its start comes with the answer
  const since = self ? self.published - 60_000 : Date.now() - 60 * 86_400_000
  const response = await igdbProxyFetch('video/list', JSON.stringify({ platform: 'twitch', id: video.channelId, since: new Date(since).toISOString() }), 30_000)
  const answer = await response.json().catch(() => null)
  if (!response.ok || !Array.isArray(answer?.videos)) throw new Error(String(answer?.error ?? response.status))
  const videos = (answer.videos as (Omit<VideoRow, 'published' | 'platform' | 'channelId' | 'gone'> & { published: string })[]).map((listed) => ({
    ...listed,
    id: `twitch-${listed.id}`, // i18n-ok
    published: Date.parse(listed.published),
  }))
  const listed = videos.find((other) => other.id === video.id)
  if (!listed) return { part: null, end: null }
  const found = pickNextPart(videos, listed, length)
  return { part: found && asPart(found, video.channelId), end: partEnd(listed, length) }
}
