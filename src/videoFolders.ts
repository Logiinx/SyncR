import { useSyncExternalStore } from 'react'
import { alertMarkId, changed, db, type VideoFolder } from './db'
import { read, write } from './localState'

// The Video tab's folders. A video's place is kept by its mark's id (see video.ts).
// channel: at the top of that channel (channelKey) instead of among your own
export async function createFolder(name: string, parentId: string | null, channel: string | null = null) {
  const id = crypto.randomUUID()
  await db.videoFolders.put({ id, name, parentId, channel, deleted: false, updatedAt: Date.now() })
  changed()
  return id
}

// null = back to the main list
export async function moveToFolder(videoId: string, folderId: string | null) {
  const id = alertMarkId(videoId)
  const place = await db.videoPlaces.get(id)
  await db.videoPlaces.put({ ...place, id, folderId, updatedAt: Date.now() })
  changed()
}

// Rewatch: a built-in folder, its own list or a section at the bottom of To watch, for what you
// watch again (finished playlists...). Its videos stay there once watched, grayed. Never saved:
// what's in it has this id as its folder (an older app version shows those as in no folder).
export const REWATCH = 'rewatch' // i18n-ok
export const rewatchFolder = (): VideoFolder => ({ id: REWATCH, name: '', parentId: null, channel: null, deleted: false, updatedAt: 0 })

// Music: the same for the Music list, which holds the videos of follows marked as music (by their
// channel, not by a move) and folders of their own. Never saved either.
export const MUSIC = 'music' // i18n-ok
export const musicFolder = (): VideoFolder => ({ id: MUSIC, name: '', parentId: null, channel: null, deleted: false, updatedAt: 0 })

// An on/off setting of this PC (Video settings window) that the Video tab follows live
function localSwitch(key: string, start = false) {
  let on = read(key, start)
  const listeners = new Set<() => void>()
  return {
    get: () => on,
    set(value: boolean) {
      on = value
      write(key, value)
      for (const listener of listeners) listener()
    },
    use: () => useSyncExternalStore((listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }, () => on),
  }
}

// Where Rewatch shows: its own list in the To watch | Rewatch | Watched switch (the default), or a
// section at the bottom of To watch
const section = localSwitch('syncr.video.rewatchSection')
export const setRewatchSection = section.set
export const useRewatchSection = section.use

// The Music button's name next to its icon (off: the icon alone, its name on hover)
const musicName = localSwitch('syncr.video.musicName', true)
export const setMusicName = musicName.set
export const useMusicName = musicName.use

// Finished playlists (no daily check) go to Rewatch by themselves: when added, when their check is
// turned off, and all at once when this is turned on. Only from the top: one in your own folder
// stays there. Turning it off leaves them where they are; one taken out by hand stays out (until
// this is turned on again).
const autoRewatch = localSwitch('syncr.video.autoRewatch')
export const autoRewatchOn = autoRewatch.get
export const useAutoRewatch = autoRewatch.use
export async function setAutoRewatch(on: boolean) {
  autoRewatch.set(on)
  if (!on) return
  const shown = await shownFolderIds()
  const moving = (await db.videoPlaylists.toArray()).filter((playlist) => !playlist.deleted && !playlist.keepChecking && !shown.has(playlist.folderId ?? ''))
  if (!moving.length) return
  await db.videoPlaylists.bulkPut(moving.map((playlist) => ({ ...playlist, folderId: REWATCH, updatedAt: Date.now() })))
  changed()
}

// The folders a playlist can be in (a deleted one's: at the top)
export async function shownFolderIds() {
  return new Set(liveFolders([rewatchFolder(), musicFolder(), ...(await db.videoFolders.toArray())]).map((folder) => folder.id))
}

// Your own folder in or out of Rewatch (null = the top)
export async function moveFolder(id: string, parentId: string | null) {
  await db.videoFolders.update(id, { parentId, updatedAt: Date.now() })
  changed()
}

// The folders in Rewatch (or another built-in one: Music), at any depth, itself included
export function inRewatch(folders: VideoFolder[], root = REWATCH) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const ids = new Set<string>()
  for (const folder of folders) {
    let at: VideoFolder | undefined = folder
    while (at?.parentId) at = byId.get(at.parentId)
    if (at?.id === root) ids.add(folder.id)
  }
  return ids
}
export const inMusic = (folders: VideoFolder[]) => inRewatch(folders, MUSIC)

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
export function liveFolders(folders: VideoFolder[]) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const alive = (folder: VideoFolder): boolean => {
    if (folder.deleted) return false
    if (!folder.parentId) return true
    const parent = byId.get(folder.parentId)
    return !!parent && alive(parent)
  }
  return folders.filter(alive).sort((a, b) => a.name.localeCompare(b.name))
}
