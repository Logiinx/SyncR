import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { isTauri } from '@tauri-apps/api/core'
import { changed, db, type VideoFollow } from './db'
import { t } from './i18n'
import { igdbProxyFetch, isComplete, useConnection } from './igdb'
import { useLocalState } from './localState'

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
}

export async function updateFollow(id: string, settings: FollowSettings) {
  await db.videoFollows.update(id, { ...settings, updatedAt: Date.now() })
  changed()
}

export async function removeFollow(id: string) {
  await db.videoFollows.update(id, { deleted: true, updatedAt: Date.now() })
  changed()
}

// The channels you follow, by name. undefined while loading.
export function useFollows() {
  return useLiveQuery(async () => {
    const follows = await db.videoFollows.filter((follow) => !follow.deleted).toArray()
    return follows.sort((a, b) => a.name.localeCompare(b.name))
  }, [])
}
