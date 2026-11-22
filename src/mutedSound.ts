import { invoke, isTauri } from '@tauri-apps/api/core'
import { alertMarkId, db, type AddedVideo, type VideoFollow, type VideoMark, type VideoRow } from './db'

// Muted sound saved ahead (DECISIONS.md "Muted sound saved ahead"): after each Video check, the
// finished streams of Twitch channels with "Save the sound of muted parts" on get the original sound
// of their muted parts saved on this PC (src-tauri/src/muted_sound.rs), before Twitch deletes it.
// Asked again at every check for 48 h after the stream's end: Twitch can mute parts later, and a
// piece that failed for a passing reason is tried again. Only what's new costs a download. A video's
// sound is deleted once it leaves the Video list, and above 2 GB the oldest videos' (muted_sound.rs).
const SAVE_FOR = 48 * 60 * 60 * 1000 // ms after the stream's end

// Twitch's video ids of the videos in the Video list (as useVideoFeed: a follow's rows its filters
// keep, and those added by their link, minus the ones cleared from Watched or deleted by Twitch)
export function soundKept(follows: VideoFollow[], videos: VideoRow[], added: AddedVideo[], marks: VideoMark[], kept: (follow: VideoFollow, video: VideoRow) => boolean) {
  const followOf = new Map(follows.filter((follow) => !follow.deleted && follow.platform === 'twitch').map((follow) => [follow.channelId, follow]))
  const cleared = new Set(marks.filter((mark) => mark.cleared).map((mark) => mark.id))
  const listed = [
    ...videos.filter((video) => video.platform === 'twitch' && followOf.has(video.channelId) && kept(followOf.get(video.channelId)!, video)),
    ...added.filter((video) => video.platform === 'twitch').map((video) => ({ ...video, id: video.videoId })),
  ]
  return [...new Set(listed.filter((video) => !video.gone && !cleared.has(alertMarkId(video.id))).map((video) => video.id.slice('twitch-'.length)))]
}

// Twitch's video ids of the streams to save now (keep: soundKept's)
export function videosToSave(follows: VideoFollow[], videos: VideoRow[], keep: Set<string>, now: number) {
  const channels = new Set(follows.filter((follow) => !follow.deleted && follow.platform === 'twitch' && follow.saveMuted).map((follow) => follow.channelId))
  return videos
    .filter((video) => video.platform === 'twitch' && channels.has(video.channelId) && !video.live && !video.gone && now - (video.published + video.duration * 1000) < SAVE_FOR)
    .map((video) => video.id.slice('twitch-'.length))
    .filter((id) => keep.has(id))
}

let saving = false

// kept: video.ts's videoKept (a follow's filters)
export async function saveMutedAhead(kept: (follow: VideoFollow, video: VideoRow) => boolean) {
  if (!isTauri() || saving) return
  saving = true
  try {
    const [follows, videos, added, marks] = await Promise.all([db.videoFollows.toArray(), db.videos.toArray(), db.addedVideos.toArray(), db.videoMarks.toArray()])
    const keep = soundKept(follows, videos, added, marks, kept)
    for (const video of videosToSave(follows, videos, new Set(keep), Date.now())) {
      await invoke('save_muted_sound', { video }).catch((e) => console.warn('Saving muted sound failed', video, e))
    }
    await invoke('tidy_muted_sound', { keep }).catch((e) => console.warn('Tidying muted sound failed', e))
  } finally {
    saving = false
  }
}

// Settings → Video: the space used (bytes), and deleting it all (those videos are never saved again)
export const mutedSoundSpace = () => invoke<number>('muted_sound_space')
export const deleteMutedSound = () => invoke('delete_muted_sound')
