import { alertMarkId, changed, db, type PlaylistEpisode, type VideoPlaylist } from './db'
import { t } from './i18n'
import { igdbProxyFetch } from './igdb'
import { read, write } from './localState'
import type { ListedVideo } from './video'

// The Video tab's YouTube playlists: read through the Worker, checked once a day if asked, played
// in their order. Checked as part of checkVideos (video.ts).

const DAY = 24 * 60 * 60 * 1000
// Like the follows' in video.ts, for the playlists: what went wrong, by playlist id
export const playlistFailures = new Map<string, { count: number; retryAt: number; message: string }>()
const PLAYLISTS_CHECKED_KEY = 'syncr.videoPlaylistsChecked' // playlist id → when its videos were last read

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
export async function checkPlaylists(force: boolean) {
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
      playlistFailures.delete(playlist.id)
    } catch (e) {
      if ((e as { offline?: boolean }).offline) return (e as Error).message
      // i18n-ok: the Worker's answer, not shown
      if ((e as { code?: string }).code === 'playlist-not-found') {
        playlistChecked(playlist.id)
        playlistFailures.delete(playlist.id)
        continue
      }
      playlistFailures.set(playlist.id, { count: 1, retryAt: 0, message: t('{name}: {error}', { name: playlist.name, error: e instanceof Error ? e.message : String(e) }) })
    }
  }
  return null
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
  const id = alertMarkId(`playlist-${found.id}`) // i18n-ok
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
    newestFirst: false,
    youtubeOrder: false,
    deleted: false,
    ...(before && { restoredAt: now }),
    updatedAt: now,
  })
  playlistChecked(id)
  changed()
  return id
}

export async function changePlaylist(id: string, change: Partial<Pick<VideoPlaylist, 'keepChecking' | 'newestFirst' | 'youtubeOrder' | 'folderId'>>) {
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

// Oldest first by upload date (same date: YouTube's order), or YouTube's order if chosen; then
// turned around for newest first. A video without a date counts as the newest.
export function playOrder<T extends { published: number }>(videos: T[], playlist: VideoPlaylist) {
  const when = (video: T) => (Number.isFinite(video.published) ? video.published : Infinity)
  const ordered = playlist.youtubeOrder ? [...videos] : [...videos].sort((a, b) => when(a) - when(b) || 0)
  return playlist.newestFirst ? ordered.reverse() : ordered
}

// The video to play after this one: the next not watched yet, in the order chosen now
export async function nextInPlaylist(playlistId: string, videoId: string) {
  const [playlist, list] = await Promise.all([db.videoPlaylists.get(playlistId), db.playlistVideos.get(playlistId)])
  if (!playlist || playlist.deleted || !list) return null
  const videos = playOrder(list.videos, playlist)
  const at = videos.findIndex((video) => video.id === videoId)
  if (at < 0) return null
  const after = videos.slice(at + 1)
  const marks = await db.videoMarks.bulkGet(after.map((video) => alertMarkId(video.id)))
  const next = after.find((_, i) => !marks[i]?.watched)
  return next ? { ...next, watched: false } : null
}
