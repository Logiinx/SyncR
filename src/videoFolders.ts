import { alertMarkId, changed, db, type VideoFolder } from './db'

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
