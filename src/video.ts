import { useEffect, useSyncExternalStore } from 'react'
import { liveQuery } from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { isTauri } from '@tauri-apps/api/core'
import { alertMarkId, changed, db, type AddedVideo, type VideoFollow, type VideoMark, type VideoRow } from './db'
import { t } from './i18n'
import { igdbProxyFetch, isComplete, useConnection } from './igdb'
import { read, useLocalState, write } from './localState'
import { inMusic, inRewatch, liveFolders, musicFolder, rewatchFolder } from './videoFolders'
import { checkPlaylists, playlistFailures, playOrder } from './videoPlaylists'
import { forgetPositions } from './videoPositions'
import { addTwitchGames } from './videoTwitch'

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

export type FollowSettings = Pick<VideoFollow, 'onlyWords' | 'exceptWords' | 'onlyGames' | 'minMinutes' | 'hideShorts' | 'music'>
export type PastChoice = 'today' | '30' | '60' | 'all'

const TWITCH_TABS = new Set(['about', 'clips', 'home', 'schedule', 'videos'])

// A pasted address in its shortest form: "name" for Twitch, "@name" for YouTube. What can't be
// shortened (youtube.com/channel/…, or another site) only loses what doesn't matter, or stays.
export function tidyChannelLink(text: string) {
  const typed = text.trim().replace(/\/+$/, '')
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(typed) ? typed : `https://${typed}`)
  } catch {
    return typed
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '')
  const parts = url.pathname.split('/').filter(Boolean)
  if (!parts.length || url.searchParams.has('v')) return typed // Just a name, or a video's link
  let path = parts.join('/')
  try {
    path = decodeURI(path)
  } catch {
    // Kept as it is
  }
  const [first, second] = path.split('/')
  if (host === 'twitch.tv') return parts.length === 1 || (parts.length === 2 && TWITCH_TABS.has(second)) ? first : `${host}/${path}`
  if (host === 'youtube.com') return first.startsWith('@') ? first : `${host}/${path}`
  return typed
}

// A bare name is a Twitch channel's: a YouTube handle starts with @ (the Worker knows how to
// read those and each site's links)
export async function findChannel(typed: string): Promise<VideoChannel> {
  const tidy = tidyChannelLink(typed)
  const link = /^[a-z0-9_]+$/i.test(tidy) ? `twitch.tv/${tidy}` : tidy // i18n-ok: an address
  const response = await igdbProxyFetch('video/channel', JSON.stringify({ link }), 15_000)
  const answer = await response.json().catch(() => null)
  if (response.ok && answer?.id) return answer
  // i18n-ok: the Worker's answer, not shown
  if (answer?.error === 'not-a-channel') throw new Error(t('This isn’t a channel. Write name for Twitch or @name for YouTube, or paste the channel’s link.'))
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
  const marks = read<ListMarks>(LIST_MARKS_KEY, {})
  delete marks[id]
  write(LIST_MARKS_KEY, marks)
  failures.delete(id)
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

const SOONEST_CHECK = 15 * 60 * 1000 // ms between checks, with few channels
const YOUTUBE_UNITS_A_DAY = 5000 // half of YouTube's daily 10,000: the test app and the pane use the same key
const DAY = 24 * 60 * 60 * 1000
const READ_BACK = 2 * DAY // a finished stream is dated from its start, so before the last check
const FIRST_RETRY = 5 * 60 * 1000 // a follow that failed; doubles each time, up to LAST_RETRY
const LAST_RETRY = 60 * 60 * 1000
const GONE_CHECK_EVERY = 24 * 60 * 60 * 1000
const CHECKED_KEY = 'syncr.videoChecked' // follow id → when its videos were last read
const GONE_KEY = 'syncr.videoGoneCheck'
// YouTube follow id → what its uploads list held when last read in full (Worker's "mark"), and when
const LIST_MARKS_KEY = 'syncr.videoListMarks'
// i18n-ok: "all that are still available" means from long before any video site
const LONG_AGO = '2000-01-01T00:00:00Z'

export interface ListedVideo {
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
let stoppedOffline = false // the last check couldn't reach the Worker: try again at the next tick
const failures = new Map<string, { count: number; retryAt: number; message: string }>() // by follow id
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
async function saveVideos(follow: VideoFollow, listed: ListedVideo[], firstCheck: boolean) {
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
  const changes = rows
    // A new follow's first videos are what you asked for, not news
    .map((row, i) => ({ ...row, games: saved[i]?.games, fresh: saved[i] ? saved[i].fresh : !firstCheck, foundAt: saved[i] ? saved[i].foundAt : firstCheck ? undefined : Date.now() }))
    .filter((row, i) => {
      const old = saved[i]
      return !old || old.gone || old.title !== row.title || old.thumbnail !== row.thumbnail || old.duration !== row.duration
    })
  if (changes.length) await db.videos.bulkPut(changes)
}

// These videos have been shown. One found before foundAt existed counts its week from now.
export async function clearFresh(videoIds: string[]) {
  const now = Date.now()
  const rows = (await db.videos.bulkGet(videoIds)).filter((row) => row?.fresh) as VideoRow[]
  if (rows.length) await db.videos.bulkPut(rows.map((row) => ({ ...row, fresh: false, foundAt: row.foundAt ?? now })))
  const shown = new Set(videoIds)
  const lists = (await db.playlistVideos.toArray()).filter((list) => list.videos.some((video) => video.fresh && shown.has(video.id)))
  if (lists.length) await db.playlistVideos.bulkPut(lists.map((list) => ({ ...list, videos: list.videos.map((video) => (shown.has(video.id) && video.fresh ? { ...video, fresh: false, foundAt: video.foundAt ?? now } : video)) })))
}

const NEW_FOR = 7 * 24 * 60 * 60 * 1000
// "New": found by a check less than a week ago, and not opened yet
export const isRecent = (video: FeedVideo) => !!video.foundAt && Date.now() - video.foundAt < NEW_FOR

type ListMarks = Record<string, { mark: string; at: number }>

// One follow. The first time everything back to its start, then back to the last check, however
// long ago: nothing is skipped after a long time away. An unchanged YouTube list needs nothing
// more, but it's read in full once a day, as that also finds edited titles and pictures.
async function checkFollow(follow: VideoFollow) {
  const lastChecked = read<Record<string, number>>(CHECKED_KEY, {})[follow.id]
  const listMark = read<ListMarks>(LIST_MARKS_KEY, {})[follow.id]
  const request = lastChecked
    ? {
        back: new Date(lastChecked - READ_BACK).toISOString(),
        known: listMark && Date.now() - listMark.at < DAY ? listMark.mark : undefined,
      }
    : { since: follow.startAt ? new Date(follow.startAt).toISOString() : LONG_AGO }
  const response = await igdbProxyFetch('video/list', JSON.stringify({ platform: follow.platform, id: follow.channelId, ...request }), 60_000)
  const answer = await response.json().catch(() => null)
  if (!response.ok || !(answer?.unchanged || Array.isArray(answer?.videos))) throw new Error(String(answer?.error ?? response.status))
  if (!answer.unchanged) {
    await saveVideos(follow, answer.videos, !lastChecked)
    if (follow.platform === 'twitch') await addTwitchGames(follow)
    const marks = read<ListMarks>(LIST_MARKS_KEY, {})
    if (answer.mark) marks[follow.id] = { mark: answer.mark, at: Date.now() }
    else delete marks[follow.id]
    write(LIST_MARKS_KEY, marks)
  }
  write(CHECKED_KEY, { ...read<Record<string, number>>(CHECKED_KEY, {}), [follow.id]: Date.now() })
}

// Once a day: which videos waiting to be watched are gone from their site. Twitch deletes old
// streams. Only with a clear answer: a problem now changes nothing.
async function checkGone() {
  if (Date.now() - read<number>(GONE_KEY, 0) < GONE_CHECK_EVERY) return
  const marks = new Map((await db.videoMarks.toArray()).map((mark) => [mark.id, mark]))
  const waiting = (await db.videos.toArray()).filter((video) => !marks.get(videoMarkId(video.id))?.watched)
  const waitingAdded = (await db.addedVideos.toArray()).filter((video) => !marks.get(video.id)?.watched)
  for (const platform of ['twitch', 'youtube'] as const) {
    const siteId = (videoId: string) => videoId.slice(platform.length + 1)
    const rows = waiting.filter((video) => video.platform === platform)
    const added = waitingAdded.filter((video) => video.platform === platform)
    const ids = [...new Set([...rows.map((row) => siteId(row.id)), ...added.map((row) => siteId(row.videoId))])]
    const existing = new Set<string>()
    for (let start = 0; start < ids.length; start += 500) {
      const response = await igdbProxyFetch('video/exists', JSON.stringify({ platform, ids: ids.slice(start, start + 500) }), 30_000)
      if (!response.ok) return
      for (const id of (await response.json()).existing) existing.add(id)
    }
    const changes = rows.filter((row) => row.gone === existing.has(siteId(row.id)))
    // Only the mark: the rows were read before the wait
    if (changes.length) await db.videos.bulkUpdate(changes.map((row) => ({ key: row.id, changes: { gone: !row.gone } })))
    // updatedAt stays: every device finds this out by itself
    for (const row of added) {
      if (row.gone === existing.has(siteId(row.videoId))) await db.addedVideos.update(row.id, { gone: !row.gone })
    }
  }
  write(GONE_KEY, Date.now())
}

// Reads all followed channels, one after the other. Asked again while running (a new follow):
// one more round after this one.
// only: just these follows (those due for a retry).
export async function checkVideos(only?: string[]) {
  if (checking) {
    checkAgain = true
    return
  }
  checking = true
  checkChanged()
  do {
    checkAgain = false
    stoppedOffline = false
    let offlineMessage: string | null = null
    let failed = false
    const follows = await db.videoFollows.filter((follow) => !follow.deleted).toArray()
    for (const follow of follows.filter((follow) => !only || only.includes(follow.id))) {
      try {
        await checkFollow(follow)
        failures.delete(follow.id)
      } catch (e) {
        // Offline: one message, no need to try the others
        if ((e as { offline?: boolean }).offline) {
          stoppedOffline = true
          offlineMessage = (e as Error).message
          break
        }
        failed = true
        const count = (failures.get(follow.id)?.count ?? 0) + 1
        failures.set(follow.id, {
          count,
          retryAt: Date.now() + Math.min(FIRST_RETRY * 2 ** (count - 1), LAST_RETRY),
          message: t('{name}: {error}', { name: follow.name, error: e instanceof Error ? e.message : String(e) }),
        })
      }
    }
    if (!stoppedOffline && !only) {
      const force = forcePlaylists
      forcePlaylists = false
      offlineMessage = await checkPlaylists(force)
    }
    if (offlineMessage) stoppedOffline = true
    if (!failed && !stoppedOffline) await checkGone().catch((e) => console.warn('Video check failed', e))
    // Also what failed earlier and is waiting for its retry
    const playlists = await db.videoPlaylists.filter((playlist) => !playlist.deleted).toArray()
    const waiting = [...follows.flatMap((item) => failures.get(item.id)?.message ?? []), ...playlists.flatMap((item) => playlistFailures.get(item.id)?.message ?? [])]
    errors = offlineMessage ? [offlineMessage, ...waiting] : waiting
    only = undefined // asked again: a new follow, so everything
  } while (checkAgain)
  checking = false
  checkChanged()
}

// How long between checks: every 15 minutes, longer once YouTube's daily quota would run out. A
// follow costs 1 unit when the Worker can say its list didn't change, 3 otherwise (a video still
// live, or a Worker from before that existed). Twitch has no such limit.
export function checkEvery(follows: VideoFollow[], marks: ListMarks) {
  const units = follows.reduce((sum, follow) => sum + (follow.platform !== 'youtube' ? 0 : marks[follow.id] ? 1 : 3), 0)
  return Math.max(SOONEST_CHECK, (units / YOUTUBE_UNITS_A_DAY) * DAY)
}

// Soon after the start, then see checkEvery. Looks every 5 minutes, so a PC waking up from sleep
// doesn't wait for the rest of the wait, and a follow that just arrived by sync (a reinstalled PC)
// gets its videos within minutes. A failed follow only retries itself: one channel that keeps
// failing mustn't make all the others use up the quota.
export function startVideoChecks() {
  let last = 0
  const tick = async () => {
    if (checking) return
    const follows = await db.videoFollows.filter((follow) => !follow.deleted).toArray()
    const now = Date.now()
    if (stoppedOffline || now - last >= checkEvery(follows, read<ListMarks>(LIST_MARKS_KEY, {}))) {
      last = now
      void checkVideos()
      return
    }
    const checked = read<Record<string, number>>(CHECKED_KEY, {})
    const due = follows.filter((follow) => {
      const failure = failures.get(follow.id)
      return failure ? failure.retryAt <= now : !checked[follow.id]
    })
    if (due.length) void checkVideos(due.map((follow) => follow.id))
  }
  const first = setTimeout(tick, 3000)
  const timer = setInterval(tick, 5 * 60 * 1000)
  return () => {
    clearTimeout(first)
    clearInterval(timer)
  }
}

// Whether a follow's rules keep this video. Title words or games: either one keeps it.
export function videoKept(follow: VideoFollow, video: VideoRow) {
  // i18n-ok
  if (follow.hideShorts && video.kind === 'short') return false
  if (follow.minMinutes && video.duration < follow.minMinutes * 60) return false
  const games = follow.onlyGames ?? []
  if (!games.length) return titleKept(follow, video.title)
  if (follow.exceptWords.length && !titleKept({ onlyWords: [], exceptWords: follow.exceptWords }, video.title)) return false
  return gamePlayed(games, video) || (follow.onlyWords.length > 0 && titleKept(follow, video.title))
}


// Whether one of these games is played in the video. Capitals and accents don't matter.
function gamePlayed(games: string[], video: VideoRow) {
  const wanted = new Set(games.map(titleKey))
  return (video.games ?? []).some((game) => wanted.has(titleKey(game.name)) || wanted.has(titleKey(game.shown)))
}


export const sameGame = (a: string, b: string) => titleKey(a) === titleKey(b)

// A mark's id, and so its file name in Dropbox, which lists names in lower case: YouTube's ids
// have capitals. A hash also keeps which videos out of the file names.
const videoMarkId = (videoId: string) => alertMarkId(videoId)

async function saveMarks(videoIds: string[], change: Partial<VideoMark>) {
  const ids = videoIds.map(videoMarkId)
  const marks = await db.videoMarks.bulkGet(ids)
  const now = Date.now()
  await db.videoMarks.bulkPut(ids.map((id, i) => ({ id, opened: false, watched: false, ...marks[i], ...change, ...(change.watched && { watchedAt: now }), updatedAt: now })))
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
export const clearWatched = (videoIds: string[]) => saveMarks(videoIds, { cleared: true })
// Rewatch's Start over: not watched, not opened, from the beginning. "Last watched" stays (an
// older mark without watchedAt keeps the day of its tick).
export async function startOver(videoIds: string[]) {
  forgetPositions(videoIds)
  const ids = videoIds.map(videoMarkId)
  const marks = await db.videoMarks.bulkGet(ids)
  const now = Date.now()
  await db.videoMarks.bulkPut(ids.map((id, i) => ({ id, ...marks[i], watchedAt: watchedAtOf(marks[i]), watched: false, opened: false, updatedAt: now })))
  changed()
}

export interface FeedVideo extends VideoRow {
  followId: string // its channel's follow; added videos of a channel not followed share their own
  channel: string
  channelIcon: string | null
  opened: boolean
  watched: boolean
  folderId: string | null // the folder it shows in; null = the main list
  watchedAt?: number // last marked as watched
  music: boolean // of a follow marked as music: in the Music list only
}

// Older marks don't have watchedAt: their last change was the tick
const watchedAtOf = (mark: VideoMark | undefined) => mark?.watchedAt ?? (mark?.watched ? mark.updatedAt : undefined)

// Which channel a video or follow is of, whether it's followed or not (folders: videoFolders.ts)
export const channelKey = (of: { platform: string; channelId: string }) => `${of.platform} ${of.channelId}` // i18n-ok

// ---------- Playlists (videoPlaylists.ts) ----------

let forcePlaylists = false // Check for new videos was clicked: not only those due today

// Check for new videos, clicked: playlists too, even if they were read today
export function checkVideosNow() {
  forcePlaylists = true
  return checkVideos()
}

// ---------- Added by link ----------

// The Worker's answers (not shown themselves) and what to say
const ADD_VIDEO_ERRORS: Record<string, () => string> = {
  'not-a-video': () => t('This isn’t a video’s link. Paste the address of a YouTube or Twitch video.'),
  'channel-link': () => t('This is a channel’s link. To get its videos, use Add a follow.'),
  'video-live': () => t('This video is still live. You can add it once it’s finished.'),
  'video-not-found': () => t('No video found at this link. It may be private or deleted.'),
}

const addedFollowId = (follow: VideoFollow | undefined, platform: string, channelId: string) =>
  follow?.id ?? `added-${platform}-${channelId}` // i18n-ok

// Puts one video in To watch, whatever its channel's rules say: you asked for this one. Gives back
// the followId it's listed under and the video to play. Already in a list: nothing changes, and
// already says which (playlistId: the playlist it's in). Throws what to tell the user if it can't,
// with the Worker's answer as its code.
export async function addOrFindVideo(link: string) {
  const response = await igdbProxyFetch('video/one', JSON.stringify({ link: link.trim() }), 15_000)
  const answer = await response.json().catch(() => null)
  if (!response.ok || !answer?.video) {
    const problem = ADD_VIDEO_ERRORS[answer?.error]
    const message = problem ? problem() : t('Could not add this video: {error}', { error: answer?.error ?? response.status })
    throw Object.assign(new Error(message), { code: String(answer?.error ?? '') })
  }
  const { platform, channel, video } = answer
  const videoId = `${platform}-${video.id}`
  const id = videoMarkId(videoId)
  const [mark, added, row, follows, playlists, lists] = await Promise.all([
    db.videoMarks.get(id),
    db.addedVideos.get(id),
    db.videos.get(videoId),
    db.videoFollows.toArray(),
    db.videoPlaylists.toArray(),
    db.playlistVideos.toArray(),
  ])
  const follow = follows.find((other) => !other.deleted && other.platform === platform && other.channelId === channel.id)
  const followId = addedFollowId(follow, platform, channel.id)
  const playable = { id: videoId, platform, title: video.title, channelId: channel.id, url: video.url, watched: !!mark?.watched, duration: video.duration }
  // A playlist's videos show only in it
  const livePlaylists = new Set(playlists.filter((playlist) => !playlist.deleted).map((playlist) => playlist.id))
  const playlistId = lists.find((list) => livePlaylists.has(list.id) && list.videos.some((episode) => episode.id === videoId))?.id
  if (playlistId) return { followId, video: playable, already: 'playlist' as const, playlistId }
  if (!mark?.cleared && (added || (row && follow && videoKept(follow, row)))) {
    return { followId, video: playable, already: mark?.watched ? ('watched' as const) : ('towatch' as const) }
  }
  const fields: AddedVideo = {
    ...added,
    id,
    videoId,
    platform,
    channelId: channel.id,
    channel: channel.name,
    channelIcon: channel.icon,
    kind: video.kind,
    title: video.title,
    url: video.url,
    thumbnail: video.thumbnail,
    published: Date.parse(video.published),
    duration: video.duration,
    gone: false,
    updatedAt: Date.now(),
  }
  await db.addedVideos.put(fields)
  // Seen before: it goes back to To watch, also if it was cleared
  if (mark) await saveMarks([videoId], { cleared: false, watched: false })
  changed()
  return { followId, video: { ...playable, watched: false }, already: null }
}

// The Add a video window: refuses what's there already. Gives back the followId it's listed under.
export async function addVideo(link: string) {
  const { followId, already } = await addOrFindVideo(link)
  if (already === 'playlist') throw new Error(t('This video is already in a playlist'))
  if (already) throw new Error(already === 'watched' ? t('This video is already in Watched') : t('This video is already in To watch'))
  return followId
}

// Each channel's videos together, the channel with the newest video first. The list comes newest
// first, and so do the videos inside each group.
export function byChannel(videos: FeedVideo[]) {
  const groups = new Map<string, FeedVideo[]>()
  for (const video of videos) {
    const group = groups.get(video.followId)
    if (group) group.push(video)
    else groups.set(video.followId, [video])
  }
  return [...groups.values()]
}

// What the Video tab shows, newest first. undefined while loading.
export function useVideoFeed() {
  return useLiveQuery(async () => {
    const [allFollows, rows, added, marks, allFolders, places, allPlaylists, playlistLists] = await Promise.all([
      db.videoFollows.toArray(),
      db.videos.toArray(),
      db.addedVideos.toArray(),
      db.videoMarks.toArray(),
      db.videoFolders.toArray(),
      db.videoPlaces.toArray(),
      db.videoPlaylists.toArray(),
      db.playlistVideos.toArray(),
    ])
    const follows = allFollows.filter((follow) => !follow.deleted).sort((a, b) => a.name.localeCompare(b.name))
    const followOf = new Map(follows.map((follow) => [channelKey(follow), follow]))
    const markOf = new Map(marks.map((mark) => [mark.id, mark]))
    const folders = liveFolders([rewatchFolder(), musicFolder(), ...allFolders])
    const folderIds = new Set(folders.map((folder) => folder.id))
    const rewatchIds = inRewatch(folders)
    const musicIds = inMusic(folders)
    const placeOf = new Map(places.map((place) => [place.id, place.folderId]))
    const addedIds = new Set(added.map((video) => video.videoId))
    const playlistRows = allPlaylists.filter((playlist) => !playlist.deleted).sort((a, b) => a.name.localeCompare(b.name))
    const listOf = new Map(playlistLists.map((list) => [list.id, list.videos]))
    const episodes = playlistRows.flatMap((playlist) => listOf.get(playlist.id) ?? [])
    // A video in a playlist shows there, not also in the main list
    const inPlaylist = new Set(episodes.map((video) => video.id))
    const listed: (Omit<FeedVideo, 'opened' | 'watched' | 'folderId' | 'music'> & { sortAt: number })[] = [
      ...rows.flatMap((video) => {
        const follow = followOf.get(channelKey(video))
        if (!follow || addedIds.has(video.id) || !videoKept(follow, video)) return []
        return [{ ...video, followId: follow.id, channel: follow.name, channelIcon: follow.icon, sortAt: video.published }]
      }),
      // By the day it was added, or an old video would sink to the bottom unseen
      ...added.map(({ videoId, updatedAt, syncedRev: _r, syncedUpdatedAt: _u, ...video }) => {
        const follow = followOf.get(channelKey(video))
        return {
          ...video,
          id: videoId,
          followId: addedFollowId(follow, video.platform, video.channelId),
          channel: follow?.name ?? video.channel,
          channelIcon: follow ? follow.icon : video.channelIcon,
          sortAt: updatedAt,
        }
      }),
    ]
    const videos = listed
      .flatMap((video) => {
        const id = videoMarkId(video.id)
        const mark = markOf.get(id)
        const place = placeOf.get(id)
        // A music video only in Music's folders, any other never there (the follow changed since)
        const music = !!followOf.get(channelKey(video))?.music
        const folderId = place && folderIds.has(place) && musicIds.has(place) === music ? place : null
        return mark?.cleared || inPlaylist.has(video.id) ? [] : [{ ...video, music, opened: !!mark?.opened, watched: !!mark?.watched, watchedAt: watchedAtOf(mark), folderId }]
      })
      .sort((a, b) => b.sortAt - a.sortAt || a.id.localeCompare(b.id))
    // Music: new songs, until ticked (which clears them); never in the other lists. They count.
    const music = videos.filter((video) => video.music && !video.watched)
    // Rewatch's videos stay there, watched or not, and never count
    const rewatch = videos.filter((video) => !video.music && video.folderId && rewatchIds.has(video.folderId))
    const others = videos.filter((video) => !video.music && (!video.folderId || !rewatchIds.has(video.folderId)))
    const toWatch = others.filter((video) => !video.watched)
    // Only what came after a playlist was added counts, or a long one would fill the count for good
    const counted = new Set(playlistRows.filter((playlist) => !playlist.folderId || !rewatchIds.has(playlist.folderId)).flatMap((playlist) => listOf.get(playlist.id) ?? []).map((video) => video.id))
    const newInPlaylists = new Set(episodes.filter((video) => {
      if (!counted.has(video.id)) return false
      const mark = markOf.get(videoMarkId(video.id))
      return video.later && !mark?.opened && !mark?.watched
    }).map((video) => video.id))
    return {
      follows,
      folders,
      toWatch,
      rewatch,
      music,
      // Watched last on top: its mark's last change is when it was marked (or opened again)
      watched: others
        .filter((video) => video.watched)
        .map((video) => ({ video, at: markOf.get(videoMarkId(video.id))?.updatedAt ?? 0 }))
        .sort((a, b) => b.at - a.at)
        .map(({ video }) => video),
      playlists: playlistRows.map((playlist) => ({
        playlist,
        videos: playOrder(listOf.get(playlist.id) ?? [], playlist).map(({ later: _later, ...video }): FeedVideo => {
          const mark = markOf.get(videoMarkId(video.id))
          return { ...video, gone: false, followId: playlist.id, channelIcon: null, music: false, opened: !!mark?.opened, watched: !!mark?.watched, watchedAt: watchedAtOf(mark), folderId: null }
        }),
      })),
      newCount: [...toWatch, ...music].filter((video) => !video.opened && !video.gone).length + newInPlaylists.size,
    }
  }, [])
}
