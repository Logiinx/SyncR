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

// Rewatch: a built-in folder at the bottom of To watch, for what you watch again (finished
// playlists...). Its videos stay there once watched, grayed. Never saved: what's in it has this
// id as its folder (an older app version shows those as in no folder).
export const REWATCH = 'rewatch' // i18n-ok
export const rewatchFolder = (): VideoFolder => ({ id: REWATCH, name: '', parentId: null, channel: null, deleted: false, updatedAt: 0 })

// Where Rewatch shows, on this PC: its own list in the To watch | Rewatch | Watched switch (the
// default), or a section at the bottom of To watch (Video settings window)
const SECTION_KEY = 'syncr.video.rewatchSection'
let asSection = read(SECTION_KEY, false)
const sectionListeners = new Set<() => void>()
export function setRewatchSection(on: boolean) {
  asSection = on
  write(SECTION_KEY, on)
  for (const listener of sectionListeners) listener()
}
export const useRewatchSection = () => useSyncExternalStore((listener) => {
  sectionListeners.add(listener)
  return () => sectionListeners.delete(listener)
}, () => asSection)

// Your own folder in or out of Rewatch (null = the top)
export async function moveFolder(id: string, parentId: string | null) {
  await db.videoFolders.update(id, { parentId, updatedAt: Date.now() })
  changed()
}

// The folders in Rewatch, at any depth
export function inRewatch(folders: VideoFolder[]) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const ids = new Set<string>()
  for (const folder of folders) {
    let at: VideoFolder | undefined = folder
    while (at?.parentId) at = byId.get(at.parentId)
    if (at?.id === REWATCH) ids.add(folder.id)
  }
  return ids
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
