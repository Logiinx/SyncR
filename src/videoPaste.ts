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
    playVideo(video, playlistId)
    void markOpened(video.id)
    return { kind: 'video', followId, added: !already }
  } catch (e) {
    // i18n-ok: the Worker's answer, not shown
    if ((e as { code?: string }).code === 'channel-link') return { kind: 'channel', link: url.href }
    throw e
  }
}
