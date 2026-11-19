// Better titles for YouTube videos from DeArrow (dearrow.ajay.app): people submit and vote on
// clearer, less clickbaity titles. Asked like SponsorBlock (video-watch.js): only the first 4
// characters of a hash of the video's id leave the PC, and the answer holds every video starting
// the same way, so DeArrow can't tell which one was asked. Saved on this device only
// (db.videoTitles). YouTube only: Twitch has nothing like it.
import { db, type VideoTitle } from './db'
import { localSwitch } from './videoFolders'

// Video settings → List, on at first (user, 2026-11-19)
const deArrow = localSwitch('syncr.video.deArrow', true)
export const setDeArrow = deArrow.set
export const useDeArrow = deArrow.use

const DAY = 86_400_000
const RECENT = 30 * DAY // a newer video still gets submissions: asked again once a day
const ASK_OLD_AGAIN = 90 * DAY
const AT_ONCE = 2 // questions at the same time (a free service: kept gentle)
const PAUSE_AFTER_FAIL = 10 * 60_000

interface Submitted {
  title: string
  original: boolean
  votes: number
  locked: boolean
}

// The title DeArrow's own extension shows: the best one (they come best first) if it's trusted
// (checked by a moderator, or not voted down) and isn't the original. None = keep YouTube's.
export function betterTitle(titles: Submitted[] | undefined, original: string) {
  const best = titles?.find((title) => title.locked || title.votes >= 0)
  if (!best || best.original || typeof best.title !== 'string') return undefined
  // A ">" before a word only tells DeArrow's formatting to leave that word alone: we don't reformat
  const title = best.title.replace(/(^|\s)>(?=\S)/g, '$1').trim()
  // At least a letter or a digit (a title of only signs is a broken submission)
  return /[\p{L}\p{N}]/u.test(title) && title.toLowerCase() !== original.trim().toLowerCase() ? title : undefined
}

async function hashStart(siteId: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(siteId)))
  return [...bytes.slice(0, 2)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

// Every video DeArrow knows whose hash starts the same way: { [siteId]: { titles } }
async function askGroup(start: string): Promise<Record<string, { titles?: Submitted[] }>> {
  const response = await fetch(`https://sponsor.ajay.app/api/branding/${start}`, { credentials: 'omit' })
  if (response.status === 404) return {} // nothing in that group
  if (!response.ok) throw new Error(`DeArrow: ${response.status}`) // i18n-ok
  return (await response.json()) ?? {}
}

const asking = new Set<string>()
let pausedUntil = 0

// Asks DeArrow about the YouTube videos among these whose answer is missing or old. Answers are
// saved in small batches: each save redraws the Video tab.
export async function checkTitles(videos: { id: string; title: string; published?: number }[]) {
  if (!deArrow.get() || Date.now() < pausedUntil) return
  const youtube = videos.filter((video) => video.id.startsWith('youtube-') && !asking.has(video.id))
  if (!youtube.length) return
  const rows = await db.videoTitles.bulkGet(youtube.map((video) => video.id))
  const now = Date.now()
  const due = youtube.filter((video, i) => {
    const row = rows[i]
    if (!row) return true
    return now - row.checkedAt >= (now - (video.published ?? 0) < RECENT ? DAY : ASK_OLD_AGAIN)
  })
  if (!due.length) return
  for (const video of due) asking.add(video.id)
  const groups = new Map<string, ReturnType<typeof askGroup>>()
  let pending: VideoTitle[] = []
  const save = async () => {
    if (!pending.length) return
    const rows = pending
    pending = []
    await db.videoTitles.bulkPut(rows)
  }
  let next = 0
  const work = async () => {
    while (next < due.length && Date.now() >= pausedUntil && deArrow.get()) {
      const video = due[next++]
      const siteId = video.id.slice('youtube-'.length)
      try {
        const start = await hashStart(siteId)
        if (!groups.has(start)) groups.set(start, askGroup(start))
        const answer = await groups.get(start)!
        const title = betterTitle(answer[siteId]?.titles, video.title)
        pending.push({ id: video.id, checkedAt: Date.now(), ...(title && { title }) })
        if (pending.length >= 20) await save()
      } catch {
        pausedUntil = Date.now() + PAUSE_AFTER_FAIL // offline or DeArrow down: later
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: AT_ONCE }, work))
    await save()
  } finally {
    for (const video of due) asking.delete(video.id)
  }
}

// The better titles saved on this device, by video id (empty when the setting is off)
export async function betterTitles(): Promise<Map<string, string>> {
  if (!deArrow.get()) return new Map()
  const rows = await db.videoTitles.toArray()
  return new Map(rows.flatMap((row) => (row.title ? [[row.id, row.title] as const] : [])))
}

// A video with its better title, the original kept for the hover card
export function withBetterTitle<V extends { id: string; title: string }>(video: V, better: Map<string, string>): V & { originalTitle?: string } {
  const title = better.get(video.id)
  return title ? { ...video, title, originalTitle: video.title } : video
}
