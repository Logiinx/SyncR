import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { alertMarkId, db } from './db'
import { t } from './i18n'
import { addOrFindVideo, markOpened } from './video'
import { addPlaylist } from './videoPlaylists'
import { playVideo } from './videoPlayer'

// A link pasted in the Video tab (Ctrl+V) or copied before the global shortcut: a video plays at
// once and goes in To watch, a playlist is added, a channel opens Add a follow filled in.

// What happened, for the Video tab to show it
export type PastedLink =
  | { kind: 'video'; followId: string; added: boolean }
  | { kind: 'playlist'; playlistId: string }
  | { kind: 'channel'; link: string }

const SITE = /(^|\.)(youtube\.com|youtu\.be|twitch\.tv)$/i

// The address in a pasted text, or null when it isn't one (then a paste does nothing). Without
// http(s):// only YouTube and Twitch addresses count, so a word with a dot isn't taken for one.
export function linkIn(text: string) {
  const typed = text.trim()
  if (!typed || /\s/.test(typed)) return null
  const full = /^https?:\/\//i.test(typed)
  try {
    const url = new URL(full ? typed : `https://${typed}`)
    return full || SITE.test(url.hostname) ? url : null
  } catch {
    return null
  }
}

// Seconds from a link's time: t=90, t=90s, t=1m30s, t=1h2m3s (YouTube and Twitch), YouTube's
// start=90 and #t=90. 0 when there's none.
export function linkTime(url: URL) {
  const raw = url.searchParams.get('t') ?? url.searchParams.get('start') ?? new URLSearchParams(url.hash.slice(1)).get('t') ?? ''
  const parts = raw.trim().toLowerCase().match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/)
  return parts ? Number(parts[1] ?? 0) * 3600 + Number(parts[2] ?? 0) * 60 + Number(parts[3] ?? 0) : 0
}

// Throws what to tell the user if it can't
export async function openPastedLink(url: URL): Promise<PastedLink> {
  if (!SITE.test(url.hostname)) throw new Error(t('Only YouTube and Twitch links can be opened here'))
  const list = url.searchParams.get('list')
  // A playlist's own page; a video playing in a playlist is the video
  if (list && url.pathname.replace(/\/+$/, '') === '/playlist') {
    const before = await db.videoPlaylists.get(alertMarkId(`playlist-${list}`)) // i18n-ok
    if (before && !before.deleted) return { kind: 'playlist', playlistId: before.id }
    return { kind: 'playlist', playlistId: await addPlaylist(url.href, true) }
  }
  try {
    const { followId, video, already, playlistId } = await addOrFindVideo(url.href)
    playVideo(video, playlistId, linkTime(url))
    void markOpened(video.id)
    return { kind: 'video', followId, added: !already }
  } catch (e) {
    // i18n-ok: the Worker's answer, not shown
    if ((e as { code?: string }).code === 'channel-link') return { kind: 'channel', link: url.href }
    throw e
  }
}

// ---------- What the Video tab shows ----------

// A line under the tab's bar while a link is read or what went wrong, and what to do in the tab
// next (Add a follow filled in, or show where a video or playlist went). Kept here, so the
// shortcut can set them while the tab isn't open; the tab shows them when it is.
export type PasteLine = { busy: boolean; message: string } | null
export type PasteAction = { kind: 'follow'; link: string } | { kind: 'show'; id: string }
let line: PasteLine = null
let action: PasteAction | null = null
let pasteAt = 0 // the latest paste: an older one finishing late changes nothing
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

export function subscribePaste(listener: () => void) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}
export const pasteLine = () => line
export const pasteAction = () => action
// The tab did it
export function pasteActionDone() {
  action = null
  notify()
}

// ---------- The shortcut (PC) ----------

// Ctrl+Alt+Shift+V anywhere in Windows: Rust reads the copied text (the page can't while SyncR is
// hidden) and sends it here. Started once the Video tab is on; it stays until SyncR closes.
export function startLinkShortcut() {
  if (!isTauri()) return
  let stop: (() => void) | null = null
  let stopped = false
  void listen<string>('link-shortcut', (event) => void pasteLink(linkIn(event.payload), true)).then((unlisten) => {
    if (stopped) unlisten()
    else stop = unlisten
  })
  invoke('start_link_shortcut').catch((error) => console.error('Link shortcut failed', error))
  return () => {
    stopped = true
    stop?.()
  }
}

function showLine(next: PasteLine, at: number) {
  line = next
  notify()
  if (next && !next.busy) setTimeout(() => at === pasteAt && line === next && ((line = null), notify()), 8000)
}

// Opens a link from a paste in the tab or from the shortcut. Only the shortcut brings the main
// window up, and only when there's something to see in it: a video just plays.
export async function pasteLink(url: URL | null, fromShortcut: boolean) {
  const at = ++pasteAt
  const bringUp = () => {
    if (fromShortcut) window.dispatchEvent(new CustomEvent('show-video-tab'))
  }
  if (!url) {
    showLine({ busy: false, message: t('The copied text isn’t a YouTube or Twitch link') }, at)
    bringUp()
    return
  }
  showLine({ busy: true, message: t('Opening the link…') }, at)
  try {
    const result = await openPastedLink(url)
    if (at !== pasteAt) return
    if (result.kind === 'channel') action = { kind: 'follow', link: result.link }
    else if (result.kind === 'playlist') action = { kind: 'show', id: result.playlistId }
    // From the shortcut, a video doesn't move the tab you may not be looking at
    else if (result.added && !fromShortcut) action = { kind: 'show', id: result.followId }
    showLine(null, at)
    if (result.kind !== 'video') bringUp()
  } catch (e) {
    if (at !== pasteAt) return
    showLine({ busy: false, message: e instanceof Error ? e.message : String(e) }, at)
    bringUp()
  }
}
