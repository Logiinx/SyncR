import { invoke, isTauri } from '@tauri-apps/api/core'
import { db, type VideoFollow, type VideoRow } from './db'

// Muted sound saved ahead (DECISIONS.md "Muted sound saved ahead"): after each Video check, the
// finished streams of Twitch channels with "Save the sound of muted parts" on get the original sound
// of their muted parts saved on this PC (src-tauri/src/muted_sound.rs), before Twitch deletes it.
// Asked again at every check for 48 h after the stream's end: Twitch can mute parts later, and a
// piece that failed for a passing reason is tried again. Only what's new costs a download.
const SAVE_FOR = 48 * 60 * 60 * 1000 // ms after the stream's end

// Twitch's video ids of the streams to save now
export function videosToSave(follows: VideoFollow[], videos: VideoRow[], now: number) {
  const channels = new Set(follows.filter((follow) => !follow.deleted && follow.platform === 'twitch' && follow.saveMuted).map((follow) => follow.channelId))
  return videos
    .filter((video) => video.platform === 'twitch' && channels.has(video.channelId) && !video.live && !video.gone && now - (video.published + video.duration * 1000) < SAVE_FOR)
    .map((video) => video.id.slice('twitch-'.length))
}

let saving = false

export async function saveMutedAhead() {
  if (!isTauri() || saving) return
  saving = true
  try {
    const follows = await db.videoFollows.toArray()
    if (!follows.some((follow) => follow.saveMuted)) return
    for (const video of videosToSave(follows, await db.videos.toArray(), Date.now())) {
      await invoke('save_muted_sound', { video }).catch((e) => console.warn('Saving muted sound failed', video, e))
    }
  } finally {
    saving = false
  }
}
