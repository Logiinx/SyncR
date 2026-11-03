import { encrypt } from './crypto'
import { db, type Snapshot } from './db'
import { deleteFile, listFolder, upload } from './dropbox'
import { cleanUpSnapshots, versionsToKeep } from './noteHistory'

// Note history in Dropbox (see noteHistory.ts): /history/<note id>/<details>, one encrypted file
// per version. The details are in the file name, so the History window and the cleanup can list
// them without downloading each one: when it was saved, protected or not, the device, words
// added and removed, and the version's hash (to show equal versions once). Dropbox can read the
// names, never the text.

export interface VersionInfo {
  path: string
  noteId: string
  savedAt: number
  protected: boolean
  device: string // lower case: "pc", "phone", "browser"
  added: number
  removed: number
  hash: string
}

type Details = Pick<Snapshot, 'noteId' | 'savedAt' | 'protected' | 'device' | 'added' | 'removed' | 'hash'>

export function versionPath(s: Details) {
  const flag = s.protected ? 'p' : 'n'
  return `/history/${s.noteId}/${s.savedAt}-${flag}-${s.device.toLowerCase()}-${s.added}-${s.removed}-${s.hash}`
}

// null: not a version (a file put there by hand…)
export function parseVersionPath(path: string): VersionInfo | null {
  const [, folder, noteId, name, more] = path.split('/')
  const parts = /^(\d+)-([pn])-([a-z]+)-(\d+)-(\d+)-([0-9a-f]+)$/.exec(name ?? '')
  if (folder !== 'history' || !noteId || more !== undefined || !parts) return null
  const [, savedAt, flag, device, added, removed, hash] = parts
  return {
    path,
    noteId,
    savedAt: Number(savedAt),
    protected: flag === 'p',
    device,
    added: Number(added),
    removed: Number(removed),
    hash,
  }
}

const CLEANED_KEY = 'syncr.history.cleanedAt'
const CLEAN_EVERY_MS = 24 * 60 * 60 * 1000

// A step of each sync (sync.ts): sends the versions saved on this device, and once a day removes
// the ones the keep rule doesn't keep anymore from Dropbox.
export async function syncHistory(key: CryptoKey) {
  for (const row of await db.snapshots.where('uploaded').equals(0).toArray()) {
    const { uploaded: _, ...version } = row
    const encrypted = await encrypt(key, new TextEncoder().encode(JSON.stringify(version)))
    await upload(versionPath(row), encrypted, 'overwrite')
    // It became protected after it was sent: the file under its old name goes
    if (row.protected) await deleteFile(versionPath({ ...row, protected: false }))
    // Unless it became protected meanwhile (then it's sent again next time)
    await db.transaction('rw', db.snapshots, async () => {
      const current = await db.snapshots.get(row.id)
      if (current && current.protected === row.protected) await db.snapshots.update(row.id, { uploaded: 1 })
    })
  }
  await cleanUpSnapshots()

  if (Date.now() - Number(localStorage.getItem(CLEANED_KEY) ?? 0) < CLEAN_EVERY_MS) return
  const byNote = new Map<string, VersionInfo[]>()
  for (const file of await listFolder('/history', true)) {
    const version = parseVersionPath(file.path)
    if (version) byNote.set(version.noteId, [...(byNote.get(version.noteId) ?? []), version])
  }
  for (const [noteId, versions] of byNote) {
    const keep = versionsToKeep(versions)
    if (!keep.size) await deleteFile(`/history/${noteId}`) // the whole folder
    else for (const version of versions) if (!keep.has(version)) await deleteFile(version.path)
  }
  localStorage.setItem(CLEANED_KEY, String(Date.now()))
}
