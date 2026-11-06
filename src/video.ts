import { useEffect, useSyncExternalStore } from 'react'
import { liveQuery } from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { isTauri } from '@tauri-apps/api/core'
import { alertMarkId, changed, db, type VideoFollow, type VideoMark, type VideoRow } from './db'
import { t } from './i18n'
import { igdbProxyFetch, isComplete, useConnection } from './igdb'
import { read, useLocalState, write } from './localState'

// The Video tab: a feed of new videos from followed YouTube and Twitch channels. For the owner's
// own use for now: it only exists when their Worker says so (their password + YOUTUBE_KEY, see
// proxy/igdb-worker.js). Everyone else sees nothing. PC only for now.

export const VIDEO_TAB = 'video' // its id among the open tabs (like GAMES_TAB)

const available = isTauri() || import.meta.env.DEV

// The Worker's answer, or null when it can't give one now (offline, Cloudflare trouble).
// Refused or unknown (a Worker without the video routes) = off.
async function askStatus() {
  try {
    const response = await igdbProxyFetch('video/status', '', 10_000)
    if (response.status >= 500) return null
    if (!response.ok) return false
    return (await response.json()).enabled === true
  } catch {
    return null
  }
}

// Whether to show the Video tab. Remembered, so it's there at once on start and when offline.
// Asked again at each start, and when the Worker's address or password changes (after a pause,
// as they're typed letter by letter in Settings).
export function useVideoEnabled() {
  const connection = useConnection()
  const [enabled, setEnabled] = useLocalState('syncr.videoFeed', false)
  const url = connection?.url
  const password = connection?.password
  useEffect(() => {
    if (!available || url === undefined) return // undefined: not loaded yet
    if (!isComplete({ url, password: password ?? '' })) {
      setEnabled(false)
      return
    }
    let stale = false
    const timer = setTimeout(() => {
      void askStatus().then((answer) => {
        if (!stale && answer !== null) setEnabled(answer)
      })
    }, 1000)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [url, password, setEnabled])
  return available && enabled
}

// ---------- Follows ----------

export interface VideoChannel {
  platform: VideoFollow['platform']
  id: string
  name: string
  icon: string | null
}

export type FollowSettings = Pick<VideoFollow, 'onlyWords' | 'exceptWords' | 'minMinutes' | 'hideShorts'>
export type PastChoice = 'today' | '30' | '60' | 'all'

// The channel a pasted link points to (the Worker knows how to read each site's links)
export async function findChannel(link: string): Promise<VideoChannel> {
  const response = await igdbProxyFetch('video/channel', JSON.stringify({ link }), 15_000)
  const answer = await response.json().catch(() => null)
  if (response.ok && answer?.id) return answer
  // i18n-ok: the Worker's answer, not shown
  if (answer?.error === 'not-a-channel') throw new Error(t('This isn’t a channel’s link. Paste one like twitch.tv/name or youtube.com/@name.'))
  // i18n-ok: the Worker's answer, not shown
  if (answer?.error === 'channel-not-found') throw new Error(t('No channel found at this link'))
  throw new Error(t('Could not look up this channel: {error}', { error: answer?.error ?? response.status }))
}

export const looksLikeYouTube = (link: string) => /youtu|^\s*@/i.test(link)

// "hotline, Talk Show,, hotline" → hotline, Talk Show. Kept as typed; compared by titleKey.
export function wordList(text: string) {
  const words = new Map<string, string>()
  for (const word of text.split(',')) {
    const clean = word.trim()
    if (clean && !words.has(titleKey(clean))) words.set(titleKey(clean), clean)
  }
  return [...words.values()]
}

// Whole minutes; anything else (empty, negative, not a number) = off
export function minuteCount(text: string) {
  const minutes = Math.floor(Number(text))
  return Number.isFinite(minutes) && minutes > 0 ? Math.min(minutes, 999) : 0
}

// Without capitals and accents: "Éte" is found by "ete"
function titleKey(text: string) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

// Whether a follow's word lists keep this title
export function titleKept(follow: Pick<VideoFollow, 'onlyWords' | 'exceptWords'>, title: string) {
  const key = titleKey(title)
  const has = (word: string) => key.includes(titleKey(word))
  return (follow.onlyWords.length === 0 || follow.onlyWords.some(has)) && !follow.exceptWords.some(has)
}

// How far back a new follow starts. "Today" counts from this morning, so a video from earlier
// today still shows.
function startOf(past: PastChoice) {
  if (past === 'all') return 0
  const today = new Date().setHours(0, 0, 0, 0)
  if (past === 'today') return today
  return new Date(today).setDate(new Date(today).getDate() - Number(past))
}

export async function addFollow(channel: VideoChannel, settings: FollowSettings, past: PastChoice) {
  const same = await db.videoFollows.filter((follow) => !follow.deleted && follow.platform === channel.platform && follow.channelId === channel.id).first()
  if (same) throw new Error(t('You already follow {name}', { name: same.name }))
  await db.videoFollows.add({
    ...settings,
    id: crypto.randomUUID(),
    platform: channel.platform,
    channelId: channel.id,
    name: channel.name,
    icon: channel.icon,
    startAt: startOf(past),
    deleted: false,
    updatedAt: Date.now(),
  })
  changed()
  void checkVideos() // its videos, right away
}

export async function updateFollow(id: string, settings: FollowSettings) {
  await db.videoFollows.update(id, { ...settings, updatedAt: Date.now() })
  changed()
}

export async function removeFollow(id: string) {
  const follow = await db.videoFollows.get(id)
  await db.videoFollows.update(id, { deleted: true, updatedAt: Date.now() })
  if (follow) await db.videos.filter((video) => video.platform === follow.platform && video.channelId === follow.channelId).delete()
  const checked = read<Record<string, number>>(CHECKED_KEY, {})
  delete checked[id]
  write(CHECKED_KEY, checked)
  changed()
}

// The channels you follow, by name. undefined while loading.
export function useFollows() {
  return useLiveQuery(async () => {
    const follows = await db.videoFollows.filter((follow) => !follow.deleted).toArray()
    return follows.sort((a, b) => a.name.localeCompare(b.name))
  }, [])
}

// ---------- Videos ----------

const CHECK_EVERY = 60 * 60 * 1000
const GONE_CHECK_EVERY = 24 * 60 * 60 * 1000
const CHECKED_KEY = 'syncr.videoChecked' // follow id → when its videos were last read
const GONE_KEY = 'syncr.videoGoneCheck'
// i18n-ok: "all that are still available" means from long before any video site
const LONG_AGO = '2000-01-01T00:00:00Z'

interface ListedVideo {
  id: string
  kind: string
  title: string
  url: string
  thumbnail: string | null
  published: string
  duration: number
  live: boolean
}

let checking = false
let checkAgain = false
let errors: string[] = []
let checkState = { checking, errors }
const listeners = new Set<() => void>()

function checkChanged() {
  checkState = { checking, errors }
  listeners.forEach((listener) => listener())
}

// For the page: a check is running, and what went wrong in the last one
export function useChecking() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => checkState,
  )
}

// Saves what can be shown: only finished videos, no older than the follow's start, and on Twitch
// only past streams (no highlights or clips). All of them, also those the word lists leave out:
// changing the lists then shows them at once, without asking the site again.
async function saveVideos(follow: VideoFollow, listed: ListedVideo[]) {
  const rows: VideoRow[] = listed
    // i18n-ok
    .filter((video) => !video.live && (follow.platform === 'youtube' || video.kind === 'archive'))
    .filter((video) => Date.parse(video.published) >= follow.startAt)
    .map((video) => ({
      id: `${follow.platform}-${video.id}`,
      platform: follow.platform,
      channelId: follow.channelId,
      kind: video.kind,
      title: video.title,
      url: video.url,
      thumbnail: video.thumbnail,
      published: Date.parse(video.published),
      duration: video.duration,
      gone: false,
    }))
  const saved = await db.videos.bulkGet(rows.map((row) => row.id))
  // Only what's new or different: every save redraws the list
  const changes = rows.filter((row, i) => {
    const old = saved[i]
    return !old || old.gone || old.title !== row.title || old.thumbnail !== row.thumbnail || old.duration !== row.duration
  })
  if (changes.length) await db.videos.bulkPut(changes)
}

// One follow. The first time everything back to its start, then the latest page is enough.
async function checkFollow(follow: VideoFollow) {
  const checked = read<Record<string, number>>(CHECKED_KEY, {})
  const since = checked[follow.id] ? undefined : follow.startAt ? new Date(follow.startAt).toISOString() : LONG_AGO
  const response = await igdbProxyFetch('video/list', JSON.stringify({ platform: follow.platform, id: follow.channelId, since }), 60_000)
  const answer = await response.json().catch(() => null)
  if (!response.ok || !Array.isArray(answer?.videos)) throw new Error(String(answer?.error ?? response.status))
  await saveVideos(follow, answer.videos)
  write(CHECKED_KEY, { ...read<Record<string, number>>(CHECKED_KEY, {}), [follow.id]: Date.now() })
}

// Once a day: which videos waiting to be watched are gone from their site. Twitch deletes old
// streams. Only with a clear answer: a problem now changes nothing.
async function checkGone() {
  if (Date.now() - read<number>(GONE_KEY, 0) < GONE_CHECK_EVERY) return
  const marks = new Map((await db.videoMarks.toArray()).map((mark) => [mark.id, mark]))
  const waiting = (await db.videos.toArray()).filter((video) => !marks.get(videoMarkId(video.id))?.watched)
  for (const platform of ['twitch', 'youtube'] as const) {
    const rows = waiting.filter((video) => video.platform === platform)
    for (let start = 0; start < rows.length; start += 500) {
      const part = rows.slice(start, start + 500)
      const siteId = (row: VideoRow) => row.id.slice(platform.length + 1)
      const response = await igdbProxyFetch('video/exists', JSON.stringify({ platform, ids: part.map(siteId) }), 30_000)
      if (!response.ok) return
      const existing = new Set<string>((await response.json()).existing)
      const changes = part.filter((row) => row.gone === existing.has(siteId(row)))
      if (changes.length) await db.videos.bulkPut(changes.map((row) => ({ ...row, gone: !row.gone })))
    }
  }
  write(GONE_KEY, Date.now())
}

// Reads all followed channels, one after the other. Asked again while running (a new follow):
// one more round after this one.
export async function checkVideos() {
  if (checking) {
    checkAgain = true
    return
  }
  checking = true
  checkChanged()
  do {
    checkAgain = false
    const found: string[] = []
    const follows = await db.videoFollows.filter((follow) => !follow.deleted).toArray()
    for (const follow of follows) {
      try {
        await checkFollow(follow)
      } catch (e) {
        // Offline: one message, no need to try the others
        if ((e as { offline?: boolean }).offline) {
          found.push((e as Error).message)
          break
        }
        found.push(t('{name}: {error}', { name: follow.name, error: e instanceof Error ? e.message : String(e) }))
      }
    }
    if (!found.length) await checkGone().catch((e) => console.warn('Video check failed', e))
    errors = found
  } while (checkAgain)
  checking = false
  checkChanged()
}

// Soon after the start, then about once an hour. Checked often, so a PC waking up from sleep
// doesn't wait for the rest of the hour, and a follow that just arrived by sync (a reinstalled
// PC) gets its videos within minutes.
export function startVideoChecks() {
  let last = 0
  const tick = async () => {
    const checked = read<Record<string, number>>(CHECKED_KEY, {})
    const unread = await db.videoFollows.filter((follow) => !follow.deleted && !checked[follow.id]).count()
    if (!unread && Date.now() - last < CHECK_EVERY) return
    last = Date.now()
    void checkVideos()
  }
  const first = setTimeout(tick, 3000)
  const timer = setInterval(tick, 5 * 60 * 1000)
  return () => {
    clearTimeout(first)
    clearInterval(timer)
  }
}

// Whether a follow's rules keep this video
export function videoKept(follow: VideoFollow, video: VideoRow) {
  // i18n-ok
  if (follow.hideShorts && video.kind === 'short') return false
  if (follow.minMinutes && video.duration < follow.minMinutes * 60) return false
  return titleKept(follow, video.title)
}

// A mark's id, and so its file name in Dropbox, which lists names in lower case: YouTube's ids
// have capitals. A hash also keeps which videos out of the file names.
const videoMarkId = (videoId: string) => alertMarkId(videoId)

async function saveMarks(videoIds: string[], change: Partial<VideoMark>) {
  const ids = videoIds.map(videoMarkId)
  const marks = await db.videoMarks.bulkGet(ids)
  await db.videoMarks.bulkPut(ids.map((id, i) => ({ id, opened: false, watched: false, ...marks[i], ...change, updatedAt: Date.now() })))
  changed()
}

// Watch one video's Watched mark; gives back how to stop
export function watchWatched(videoId: string, onChange: (watched: boolean) => void) {
  const subscription = liveQuery(() => db.videoMarks.get(videoMarkId(videoId))).subscribe({
    next: (mark) => onChange(!!mark?.watched),
    error: (error) => console.error('Video mark failed', error),
  })
  return () => subscription.unsubscribe()
}

export const markOpened = (videoId: string) => saveMarks([videoId], { opened: true })
export const setWatched = (videoId: string, watched: boolean) => saveMarks([videoId], { watched })
export const markAllWatched = (videoIds: string[]) => saveMarks(videoIds, { watched: true })

export interface FeedVideo extends VideoRow {
  followId: string
  channel: string
  opened: boolean
  watched: boolean
}

// What the Video tab shows, newest first. undefined while loading.
export function useVideoFeed() {
  return useLiveQuery(async () => {
    const [allFollows, rows, marks] = await Promise.all([db.videoFollows.toArray(), db.videos.toArray(), db.videoMarks.toArray()])
    const follows = allFollows.filter((follow) => !follow.deleted).sort((a, b) => a.name.localeCompare(b.name))
    const byChannel = new Map(follows.map((follow) => [`${follow.platform} ${follow.channelId}`, follow]))
    const markOf = new Map(marks.map((mark) => [mark.id, mark]))
    const videos = rows
      .flatMap((video): FeedVideo[] => {
        const follow = byChannel.get(`${video.platform} ${video.channelId}`)
        if (!follow || !videoKept(follow, video)) return []
        const mark = markOf.get(videoMarkId(video.id))
        return [{ ...video, followId: follow.id, channel: follow.name, opened: !!mark?.opened, watched: !!mark?.watched }]
      })
      .sort((a, b) => b.published - a.published || a.id.localeCompare(b.id))
    const toWatch = videos.filter((video) => !video.watched)
    return {
      follows,
      toWatch,
      watched: videos.filter((video) => video.watched),
      newCount: toWatch.filter((video) => !video.opened && !video.gone).length,
    }
  }, [])
}
