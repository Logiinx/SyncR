import { useEffect, useState } from 'react'
import { decrypt, encrypt, getKey } from './crypto'
import { db, type Snapshot } from './db'
import { deleteFile, deleteFiles, download, isConnected, listFolder, uploadMany, type Upload } from './dropbox'
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

// The versions of a note, newest first: the ones in Dropbox and those not sent yet. A version
// saved twice in a row (the other device saved the same one when it started editing) shows
// once: the first time it was saved, protected if either was.
export async function listVersions(noteId: string): Promise<VersionInfo[]> {
  const versions = (await listFolder(`/history/${noteId}`)).map((file) => parseVersionPath(file.path))
  const waiting = await db.snapshots.where('noteId').equals(noteId).filter((row) => !row.uploaded).toArray()
  const all = [...versions.filter((v) => v !== null), ...waiting.map((row) => ({ ...row, path: versionPath(row) }))]
  all.sort((a, b) => a.savedAt - b.savedAt)
  const shown: VersionInfo[] = []
  for (const version of all) {
    const previous = shown[shown.length - 1]
    if (previous?.hash === version.hash) previous.protected ||= version.protected
    else shown.push({ ...version, device: version.device.toLowerCase() })
  }
  return shown.reverse()
}

// True while the history can be read: Dropbox connected and online (the History button, Toolbar.tsx)
export function useHistoryAvailable() {
  const check = () => isConnected() && navigator.onLine
  const [available, setAvailable] = useState(check)
  useEffect(() => {
    const update = () => setAvailable(check())
    for (const event of ['online', 'offline']) window.addEventListener(event, update)
    window.addEventListener('dropbox-change', update)
    return () => {
      for (const event of ['online', 'offline']) window.removeEventListener(event, update)
      window.removeEventListener('dropbox-change', update)
    }
  }, [])
  return available
}

export type VersionText = Pick<Snapshot, 'title' | 'content' | 'text'>

// No passphrase entered on this device: versions in Dropbox can't be read
export class NeedsPassphraseError extends Error {}

// One version's text: from this device if it still has it, else from Dropbox (decrypted)
export async function loadVersion(version: VersionInfo): Promise<VersionText> {
  const local = await db.snapshots.get(`${version.noteId}-${version.savedAt}`)
  if (local) return local
  const key = await getKey()
  if (!key) throw new NeedsPassphraseError()
  const raw = await download(version.path)
  if (!raw) throw new Error('This version is gone from Dropbox') // i18n-ok
  return JSON.parse(new TextDecoder().decode(await decrypt(key, raw)))
}

const CLEANED_KEY = 'syncr.history.cleanedAt'
const CLEAN_EVERY_MS = 24 * 60 * 60 * 1000

// A step of each sync (sync.ts): sends the versions saved on this device, and once a day removes
// the ones the keep rule doesn't keep anymore from Dropbox.
export async function syncHistory(key: CryptoKey) {
  // Sent together, in as few Dropbox writes as possible
  const rows = await db.snapshots.where('uploaded').equals(0).toArray()
  const files: Upload[] = []
  for (const row of rows) {
    const { uploaded: _, ...version } = row
    files.push({ path: versionPath(row), data: await encrypt(key, new TextEncoder().encode(JSON.stringify(version))), mode: 'overwrite' })
  }
  const { revs, error } = await uploadMany(files)
  for (const [i, rev] of revs.entries()) {
    if (!rev) continue // not sent: next time
    const row = rows[i]
    // It became protected after it was sent: the file under its old name goes
    if (row.protected) await deleteFile(versionPath({ ...row, protected: false }))
    // Unless it became protected meanwhile (then it's sent again next time)
    await db.transaction('rw', db.snapshots, async () => {
      const current = await db.snapshots.get(row.id)
      if (current && current.protected === row.protected) await db.snapshots.update(row.id, { uploaded: 1 })
    })
  }
  if (error) throw error
  await cleanUpSnapshots()

  if (Date.now() - Number(localStorage.getItem(CLEANED_KEY) ?? 0) < CLEAN_EVERY_MS) return
  const byNote = new Map<string, VersionInfo[]>()
  for (const file of await listFolder('/history', true)) {
    const version = parseVersionPath(file.path)
    if (version) byNote.set(version.noteId, [...(byNote.get(version.noteId) ?? []), version])
  }
  // File by file (in one batch), never a note's whole folder: the other device may be adding a
  // version to it right now. A folder left empty stays (sync never reads history/).
  const old: string[] = []
  for (const versions of byNote.values()) {
    const keep = versionsToKeep(versions)
    for (const version of versions) if (!keep.has(version)) old.push(version.path)
  }
  await deleteFiles(old)
  localStorage.setItem(CLEANED_KEY, String(Date.now()))
}
