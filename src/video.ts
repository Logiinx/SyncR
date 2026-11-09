import { useEffect, useSyncExternalStore } from 'react'
import { liveQuery } from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { isTauri } from '@tauri-apps/api/core'
import { alertMarkId, changed, db, type AddedVideo, type VideoGame, type PlaylistEpisode, type VideoFolder, type VideoFollow, type VideoMark, type VideoPlaylist, type VideoRow } from './db'
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

export type FollowSettings = Pick<VideoFollow, 'onlyWords' | 'exceptWords' | 'onlyGames' | 'minMinutes' | 'hideShorts'>
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
    .map((row, i) => ({ ...row, games: saved[i]?.games, fresh: saved[i] ? saved[i].fresh : !firstCheck }))
    .filter((row, i) => {
      const old = saved[i]
      return !old || old.gone || old.title !== row.title || old.thumbnail !== row.thumbnail || old.duration !== row.duration
    })
  if (changes.length) await db.videos.bulkPut(changes)
}

// These videos have been shown: not new anymore the next time the tab opens
export async function clearFresh(videoIds: string[]) {
  const rows = (await db.videos.bulkGet(videoIds)).filter((row) => row?.fresh) as VideoRow[]
  if (rows.length) await db.videos.bulkPut(rows.map((row) => ({ ...row, fresh: false })))
  const shown = new Set(videoIds)
  const lists = (await db.playlistVideos.toArray()).filter((list) => list.videos.some((video) => video.fresh && shown.has(video.id)))
  if (lists.length) await db.playlistVideos.bulkPut(lists.map((list) => ({ ...list, videos: list.videos.map((video) => (shown.has(video.id) ? { ...video, fresh: false } : video)) })))
}

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
    if (!stoppedOffline && !only) offlineMessage = await checkPlaylists()
    if (offlineMessage) stoppedOffline = true
    if (!failed && !stoppedOffline) await checkGone().catch((e) => console.warn('Video check failed', e))
    // Also what failed earlier and is waiting for its retry
    const playlists = await db.videoPlaylists.filter((playlist) => !playlist.deleted).toArray()
    const waiting = [...follows, ...playlists].flatMap((item) => failures.get(item.id)?.message ?? [])
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

// ---------- Twitch games ----------
// Twitch's official list of a channel's videos has no games. Its website's data has them, with
// every game change, so the app asks for it directly (like the own Twitch player), with the
// public id of Twitch's website.

const TWITCH_SITE_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko' // i18n-ok
const GAME_PAGES = 3 // 100 videos a page: Twitch keeps past streams 7 to 60 days

async function askTwitchSite<T>(query: string): Promise<T> {
  const response = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Client-ID': TWITCH_SITE_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(20_000),
  })
  const answer = await response.json().catch(() => null)
  if (!response.ok || !answer?.data) throw new Error(t('Twitch answered {status}', { status: response.status }))
  return answer.data
}

interface SiteGame {
  name: string
  displayName: string
}
interface SiteVideos {
  user: { videos: { pageInfo: { hasNextPage: boolean }; edges: { cursor: string; node: { id: string; game: SiteGame | null; moments: { edges: { node: { details: { game?: SiteGame } | null } }[] } | null } }[] } } | null
}

// Fills in the games of this follow's videos that don't have them yet: a page of 100 at a time,
// newest first, until none is missing. A problem leaves them for the next check. Those Twitch
// doesn't list anymore (deleted, or older than the pages read) get none, so they aren't looked for
// at every check. Only the games are written: the rows may have changed during the wait (New
// taken off by the tab).
async function addTwitchGames(follow: VideoFollow) {
  const missing = new Set(
    (await db.videos.filter((video) => video.platform === 'twitch' && video.channelId === follow.channelId && !video.games).primaryKeys()) as string[],
  )
  const saveGames = (found: { key: string; changes: Partial<VideoRow> }[]) => (found.length ? db.videos.bulkUpdate(found) : 0)
  let cursor = ''
  for (let page = 0; page < GAME_PAGES && missing.size; page++) {
    const game = 'name displayName' // i18n-ok
    const data = await askTwitchSite<SiteVideos>(
      // i18n-ok
      `{ user(id: ${JSON.stringify(follow.channelId)}) { videos(first: 100, type: ARCHIVE${cursor ? `, after: ${JSON.stringify(cursor)}` : ''}) { pageInfo { hasNextPage } edges { cursor node { id game { ${game} } moments(first: 100, types: [GAME_CHANGE], momentRequestType: VIDEO_CHAPTER_MARKERS) { edges { node { details { ... on GameChangeMomentDetails { game { ${game} } } } } } } } } } } }`,
    )
    const videos = data.user?.videos
    if (!videos) return
    const found: { key: string; changes: Partial<VideoRow> }[] = []
    for (const { node } of videos.edges) {
      const id = `twitch-${node.id}`
      if (!missing.has(id)) continue
      const games = new Map<string, VideoGame>()
      for (const game of [node.game, ...(node.moments?.edges ?? []).map((edge) => edge.node.details?.game)]) {
        if (game?.name && !games.has(game.name)) games.set(game.name, { name: game.name, shown: game.displayName || game.name })
      }
      found.push({ key: id, changes: { games: [...games.values()] } })
      missing.delete(id)
    }
    await saveGames(found)
    if (!videos.pageInfo.hasNextPage || !videos.edges.length) break
    cursor = videos.edges[videos.edges.length - 1].cursor
  }
  await saveGames([...missing].map((key) => ({ key, changes: { games: [] } })))
}

// Whether one of these games is played in the video. Capitals and accents don't matter.
function gamePlayed(games: string[], video: VideoRow) {
  const wanted = new Set(games.map(titleKey))
  return (video.games ?? []).some((game) => wanted.has(titleKey(game.name)) || wanted.has(titleKey(game.shown)))
}

// Suggestions while typing a game for a follow: the games this channel played, newest first,
// then Twitch's matches for the text
export async function channelGames(channelId: string) {
  const rows = await db.videos.filter((video) => video.platform === 'twitch' && video.channelId === channelId).toArray()
  rows.sort((a, b) => b.published - a.published)
  return [...new Set(rows.flatMap((row) => (row.games ?? []).map((game) => game.shown)))]
}

export async function searchTwitchGames(text: string): Promise<string[]> {
  const data = await askTwitchSite<{ searchCategories: { edges: { node: { displayName: string } }[] } | null }>(
    `{ searchCategories(query: ${JSON.stringify(text)}, first: 8) { edges { node { displayName } } } }`,
  )
  return (data.searchCategories?.edges ?? []).map((edge) => edge.node.displayName)
}

export const sameGame = (a: string, b: string) => titleKey(a) === titleKey(b)

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
export const clearWatched = (videoIds: string[]) => saveMarks(videoIds, { cleared: true })

export interface FeedVideo extends VideoRow {
  followId: string // its channel's follow; added videos of a channel not followed share their own
  channel: string
  channelIcon: string | null
  opened: boolean
  watched: boolean
  folderId: string | null // the folder it shows in; null = the main list
}

// ---------- Folders ----------

// Which channel a video or follow is of, whether it's followed or not
export const channelKey = (of: { platform: string; channelId: string }) => `${of.platform} ${of.channelId}` // i18n-ok

// channel: at the top of that channel (channelKey) instead of among your own
export async function createFolder(name: string, parentId: string | null, channel: string | null = null) {
  const id = crypto.randomUUID()
  await db.videoFolders.put({ id, name, parentId, channel, deleted: false, updatedAt: Date.now() })
  changed()
  return id
}

// null = back to the main list
export async function moveToFolder(videoId: string, folderId: string | null) {
  const id = videoMarkId(videoId)
  const place = await db.videoPlaces.get(id)
  await db.videoPlaces.put({ ...place, id, folderId, updatedAt: Date.now() })
  changed()
}

export async function renameFolder(id: string, name: string) {
  await db.videoFolders.update(id, { name, updatedAt: Date.now() })
  changed()
}

// With its sub-folders. Their videos show in the main list from then on: see liveFolders.
export async function deleteFolder(id: string) {
  const folders = await db.videoFolders.toArray()
  const gone = new Set([id])
  // Parents can only be chosen when a folder is made, so there are no loops
  for (let more = true; more; ) {
    more = false
    for (const folder of folders) {
      if (folder.parentId && gone.has(folder.parentId) && !gone.has(folder.id)) {
        gone.add(folder.id)
        more = true
      }
    }
  }
  await db.videoFolders.bulkPut(folders.filter((folder) => gone.has(folder.id)).map((folder) => ({ ...folder, deleted: true, updatedAt: Date.now() })))
  changed()
}

// The folders that show, by name. One whose parent was deleted (a sub-folder made on another device
// at the same time) doesn't: it would be out of reach, with its videos in it.
function liveFolders(folders: VideoFolder[]) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const alive = (folder: VideoFolder): boolean => {
    if (folder.deleted) return false
    if (!folder.parentId) return true
    const parent = byId.get(folder.parentId)
    return !!parent && alive(parent)
  }
  return folders.filter(alive).sort((a, b) => a.name.localeCompare(b.name))
}

// ---------- Playlists ----------

const PLAYLISTS_CHECKED_KEY = 'syncr.videoPlaylistsChecked' // playlist id → when its videos were last read
let forcePlaylists = false // Check for new videos was clicked: not only those due today

export const playlistAddress = (playlist: VideoPlaylist) => `https://www.youtube.com/playlist?list=${playlist.listId}`

// All of a playlist's pages, a request each. A problem has the Worker's answer as its code.
async function readPlaylist(link: string) {
  const videos: (ListedVideo & { channel: string; channelId: string })[] = []
  let info: { id: string; name: string } | null = null
  let pageToken: string | null = null
  do {
    const response: Response = await igdbProxyFetch('video/playlist', JSON.stringify({ link, pageToken }), 30_000)
    const answer = await response.json().catch(() => null)
    if (!response.ok || !Array.isArray(answer?.videos)) throw Object.assign(new Error(String(answer?.error ?? response.status)), { code: String(answer?.error ?? '') })
    info ??= { id: answer.id, name: answer.name }
    videos.push(...answer.videos)
    pageToken = answer.nextPageToken
  } while (pageToken)
  return { ...info!, videos }
}

// Saves what YouTube lists, in its order. A video can be in a playlist twice: only its first place.
// The first time they're what you asked for, not news.
async function saveEpisodes(id: string, listed: Awaited<ReturnType<typeof readPlaylist>>['videos'], first: boolean) {
  const saved = (await db.playlistVideos.get(id))?.videos ?? []
  const old = new Map(saved.map((video) => [video.id, video]))
  const seen = new Set<string>()
  const videos: PlaylistEpisode[] = listed.flatMap((video) => {
    const rowId = `youtube-${video.id}`
    if (seen.has(rowId)) return []
    seen.add(rowId)
    const before = old.get(rowId)
    return [{
      id: rowId,
      platform: 'youtube' as const,
      channelId: video.channelId,
      channel: video.channel,
      kind: video.kind,
      title: video.title,
      url: video.url,
      thumbnail: video.thumbnail,
      published: Date.parse(video.published),
      duration: video.duration,
      fresh: before ? before.fresh : !first,
      later: before ? before.later : !first,
    }]
  })
  // Only when different: every save redraws the list
  if (first || JSON.stringify(videos) !== JSON.stringify(saved)) await db.playlistVideos.put({ id, videos })
}

function playlistChecked(id: string) {
  write(PLAYLISTS_CHECKED_KEY, { ...read<Record<string, number>>(PLAYLISTS_CHECKED_KEY, {}), [id]: Date.now() })
}

// Once a day those that keep checking. Any playlist whose videos aren't here yet (it arrived by
// sync) gets them once. One removed from YouTube keeps the videos it had. Gives back what to say
// when offline.
async function checkPlaylists() {
  const force = forcePlaylists
  forcePlaylists = false
  const [all, lists] = await Promise.all([db.videoPlaylists.toArray(), db.playlistVideos.toArray()])
  const live = all.filter((playlist) => !playlist.deleted)
  const liveIds = new Set(live.map((playlist) => playlist.id))
  // Removed on another device
  const leftOver = lists.filter((list) => !liveIds.has(list.id)).map((list) => list.id)
  if (leftOver.length) await db.playlistVideos.bulkDelete(leftOver)
  const have = new Set(lists.map((list) => list.id))
  const checked = read<Record<string, number>>(PLAYLISTS_CHECKED_KEY, {})
  for (const playlist of live) {
    const first = !have.has(playlist.id)
    if (!first && (!playlist.keepChecking || (!force && Date.now() - (checked[playlist.id] ?? 0) < DAY))) continue
    try {
      await saveEpisodes(playlist.id, (await readPlaylist(playlistAddress(playlist))).videos, first)
      playlistChecked(playlist.id)
      failures.delete(playlist.id)
    } catch (e) {
      if ((e as { offline?: boolean }).offline) return (e as Error).message
      // i18n-ok: the Worker's answer, not shown
      if ((e as { code?: string }).code === 'playlist-not-found') {
        playlistChecked(playlist.id)
        failures.delete(playlist.id)
        continue
      }
      failures.set(playlist.id, { count: 1, retryAt: 0, message: t('{name}: {error}', { name: playlist.name, error: e instanceof Error ? e.message : String(e) }) })
    }
  }
  return null
}

// Check for new videos, clicked: playlists too, even if they were read today
export function checkVideosNow() {
  forcePlaylists = true
  return checkVideos()
}

// Throws what to tell the user if it can't, or if it's there already
export async function addPlaylist(link: string, keepChecking: boolean) {
  let found
  try {
    found = await readPlaylist(link.trim())
  } catch (e) {
    const code = (e as { code?: string }).code
    if ((e as { offline?: boolean }).offline) throw e
    // i18n-ok: the Worker's answer, not shown
    if (code === 'not-a-playlist') throw new Error(t('This isn’t a playlist’s link. Paste the address of a YouTube playlist.'))
    // i18n-ok: the Worker's answer, not shown
    if (code === 'playlist-not-found') throw new Error(t('No playlist found at this link. It may be private.'))
    // i18n-ok: the Worker's answer, not shown
    if (code?.startsWith('Unknown endpoint')) throw new Error(t('Your Worker needs its latest version for playlists.'))
    throw new Error(t('Could not add this playlist: {error}', { error: e instanceof Error ? e.message : String(e) }), { cause: e })
  }
  const id = videoMarkId(`playlist-${found.id}`) // i18n-ok
  const before = await db.videoPlaylists.get(id)
  if (before && !before.deleted) throw new Error(t('This playlist is already in the list'))
  const now = Date.now()
  await saveEpisodes(id, found.videos, true)
  await db.videoPlaylists.put({
    ...before,
    id,
    listId: found.id,
    name: found.name,
    keepChecking,
    reversed: false,
    deleted: false,
    ...(before && { restoredAt: now }),
    updatedAt: now,
  })
  playlistChecked(id)
  changed()
  return id
}

export async function changePlaylist(id: string, change: Partial<Pick<VideoPlaylist, 'keepChecking' | 'reversed'>>) {
  await db.videoPlaylists.update(id, { ...change, updatedAt: Date.now() })
  changed()
}

// The marks stay, like when a follow is removed. Its videos show in the main list again if their
// channel is followed.
export async function removePlaylist(id: string) {
  await db.videoPlaylists.update(id, { deleted: true, updatedAt: Date.now() })
  await db.playlistVideos.delete(id)
  changed()
}

const playOrder = <T,>(videos: T[], playlist: VideoPlaylist) => (playlist.reversed ? [...videos].reverse() : videos)

// The video to play after this one: the next not watched yet, in the order chosen now
export async function nextInPlaylist(playlistId: string, videoId: string) {
  const [playlist, list] = await Promise.all([db.videoPlaylists.get(playlistId), db.playlistVideos.get(playlistId)])
  if (!playlist || playlist.deleted || !list) return null
  const videos = playOrder(list.videos, playlist)
  const at = videos.findIndex((video) => video.id === videoId)
  if (at < 0) return null
  const after = videos.slice(at + 1)
  const marks = await db.videoMarks.bulkGet(after.map((video) => videoMarkId(video.id)))
  const next = after.find((_, i) => !marks[i]?.watched)
  return next ? { ...next, watched: false } : null
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
// the followId it's listed under. Throws what to tell the user if it can't, or if it's there already.
export async function addVideo(link: string) {
  const response = await igdbProxyFetch('video/one', JSON.stringify({ link: link.trim() }), 15_000)
  const answer = await response.json().catch(() => null)
  if (!response.ok || !answer?.video) {
    const problem = ADD_VIDEO_ERRORS[answer?.error]
    throw new Error(problem ? problem() : t('Could not add this video: {error}', { error: answer?.error ?? response.status }))
  }
  const { platform, channel, video } = answer
  const videoId = `${platform}-${video.id}`
  const id = videoMarkId(videoId)
  const [mark, added, row, follows] = await Promise.all([db.videoMarks.get(id), db.addedVideos.get(id), db.videos.get(videoId), db.videoFollows.toArray()])
  const follow = follows.find((other) => !other.deleted && other.platform === platform && other.channelId === channel.id)
  if (!mark?.cleared && (added || (row && follow && videoKept(follow, row)))) {
    throw new Error(mark?.watched ? t('This video is already in Watched') : t('This video is already in To watch'))
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
  return addedFollowId(follow, platform, channel.id)
}

// Each channel's videos together, the channel with the newest video first. The list comes newest
// first, and so do the videos inside each group.
export function byChannel(videos: FeedVideo[]) {
  const groups = new Map<string, FeedVideo[]>()
  for (const video of videos) groups.set(video.followId, [...(groups.get(video.followId) ?? []), video])
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
    const followOf = new Map(follows.map((follow) => [`${follow.platform} ${follow.channelId}`, follow]))
    const markOf = new Map(marks.map((mark) => [mark.id, mark]))
    const folders = liveFolders(allFolders)
    const folderIds = new Set(folders.map((folder) => folder.id))
    const placeOf = new Map(places.map((place) => [place.id, place.folderId]))
    const addedIds = new Set(added.map((video) => video.videoId))
    const playlistRows = allPlaylists.filter((playlist) => !playlist.deleted).sort((a, b) => a.name.localeCompare(b.name))
    const listOf = new Map(playlistLists.map((list) => [list.id, list.videos]))
    const episodes = playlistRows.flatMap((playlist) => listOf.get(playlist.id) ?? [])
    // A video in a playlist shows there, not also in the main list
    const inPlaylist = new Set(episodes.map((video) => video.id))
    const listed: (Omit<FeedVideo, 'opened' | 'watched' | 'folderId'> & { sortAt: number })[] = [
      ...rows.flatMap((video) => {
        const follow = followOf.get(`${video.platform} ${video.channelId}`)
        if (!follow || addedIds.has(video.id) || !videoKept(follow, video)) return []
        return [{ ...video, followId: follow.id, channel: follow.name, channelIcon: follow.icon, sortAt: video.published }]
      }),
      // By the day it was added, or an old video would sink to the bottom unseen
      ...added.map(({ videoId, updatedAt, syncedRev: _r, syncedUpdatedAt: _u, ...video }) => {
        const follow = followOf.get(`${video.platform} ${video.channelId}`)
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
        return mark?.cleared || inPlaylist.has(video.id) ? [] : [{ ...video, opened: !!mark?.opened, watched: !!mark?.watched, folderId: place && folderIds.has(place) ? place : null }]
      })
      .sort((a, b) => b.sortAt - a.sortAt || a.id.localeCompare(b.id))
    const toWatch = videos.filter((video) => !video.watched)
    // Only what came after a playlist was added counts, or a long one would fill the count for good
    const newInPlaylists = new Set(episodes.filter((video) => {
      const mark = markOf.get(videoMarkId(video.id))
      return video.later && !mark?.opened && !mark?.watched
    }).map((video) => video.id))
    return {
      follows,
      folders,
      toWatch,
      watched: videos.filter((video) => video.watched),
      playlists: playlistRows.map((playlist) => ({
        playlist,
        videos: playOrder(listOf.get(playlist.id) ?? [], playlist).map(({ later: _later, ...video }): FeedVideo => {
          const mark = markOf.get(videoMarkId(video.id))
          return { ...video, gone: false, followId: playlist.id, channelIcon: null, opened: !!mark?.opened, watched: !!mark?.watched, folderId: null }
        }),
      })),
      newCount: toWatch.filter((video) => !video.opened && !video.gone).length + newInPlaylists.size,
    }
  }, [])
}
