import { isTauri } from '@tauri-apps/api/core'
import { db, noteTitle, type Note } from './db'
import { decrypt, encrypt, getKey } from './crypto'
import { deleteFile, download, listFiles, upload } from './dropbox'

// Two-way sync between this device and Dropbox. Everything in Dropbox is encrypted.
//   /notes/<id>    one file per note
//   /deleted/<id>  marker left when a note is deleted, so other devices delete it too
// Rules (see DECISIONS.md, "Sync plan"):
// - A note changed on one side only: that version is copied to the other side.
// - Changed on both sides: the newest keeps the note, the other becomes a conflict copy.
// - Deleted on one side but edited on the other: the edit wins, the note comes back.

// What's stored in /notes/<id> (before encryption)
interface RemoteNote {
  id: string
  title: string | null
  content: Note['content']
  text: string
  createdAt: number
  updatedAt: number
  device: string // which device saved this version, for conflict copy titles
}

export interface SyncResult {
  uploaded: number
  downloaded: number
  deleted: number
  conflicts: number
  cursor: string // Dropbox's "bookmark" for this sync, to wait for later changes
}

// Something changed in Dropbox during the sync. Trying again a bit later fixes it.
export class RetrySoonError extends Error {}

export function deviceName() {
  if (isTauri()) return 'PC'
  if (/Android|iPhone|iPad/i.test(navigator.userAgent)) return 'phone'
  return 'browser'
}

const notePath = (id: string) => `/notes/${id}`
const deletedPath = (id: string) => `/deleted/${id}`

let running = false

export async function syncNow(): Promise<SyncResult> {
  if (running) throw new Error('Sync is already running.')
  running = true
  try {
    return await runSync()
  } finally {
    running = false
  }
}

async function runSync(): Promise<SyncResult> {
  const key = await getKey()
  if (!key) throw new Error('Enter your passphrase first.')
  const result: SyncResult = { uploaded: 0, downloaded: 0, deleted: 0, conflicts: 0, cursor: '' }

  // ---------- Encrypted read / write ----------

  async function uploadNote(note: Note, mode: 'add' | { update: string }) {
    const data: RemoteNote = { ...note, device: deviceName() }
    const encrypted = await encrypt(key!, new TextEncoder().encode(JSON.stringify(data)))
    const rev = await upload(notePath(note.id), encrypted, mode)
    if (!rev) throw new RetrySoonError('A note changed in Dropbox during sync.')
    await db.synced.put({ id: note.id, rev, updatedAt: note.updatedAt })
    result.uploaded++
  }

  async function downloadNote(id: string): Promise<RemoteNote | null> {
    const raw = await download(notePath(id))
    if (!raw) return null
    return JSON.parse(new TextDecoder().decode(await decrypt(key!, raw)))
  }

  // Saves a downloaded note locally without changing its dates
  async function storeNote(remote: RemoteNote, rev: string) {
    const { device: _, ...note } = remote
    await db.transaction('rw', db.notes, db.synced, async () => {
      await db.notes.put(note)
      await db.synced.put({ id: note.id, rev, updatedAt: note.updatedAt })
    })
    result.downloaded++
  }

  // Keeps a version that lost a conflict, as a new note
  async function saveConflictCopy(note: Note, device: string) {
    const when = new Date(note.updatedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
    await db.notes.add({
      ...note,
      id: crypto.randomUUID(),
      title: `${noteTitle(note)} (conflict, ${device}, ${when})`,
    })
    result.conflicts++
  }

  // ---------- What's where ----------

  const remoteNotes = new Map<string, string>() // id -> rev
  const remoteDeleted = new Set<string>()
  const { files, cursor } = await listFiles()
  result.cursor = cursor
  for (const file of files) {
    const [, folder, id] = file.path.split('/')
    if (folder === 'notes') remoteNotes.set(id, file.rev)
    if (folder === 'deleted') remoteDeleted.add(id)
  }
  const synced = new Map((await db.synced.toArray()).map((s) => [s.id, s]))
  const isChangedLocally = (note: Note) => synced.get(note.id)?.updatedAt !== note.updatedAt
  const done = new Set<string>() // notes fully handled by an earlier step

  // ---------- 1. Notes deleted on this device ----------

  for (const deletion of await db.deletions.toArray()) {
    const id = deletion.id
    const remoteRev = remoteNotes.get(id)
    const last = synced.get(id)
    if (remoteRev && last && remoteRev !== last.rev) {
      // Edited on the other device after our last sync: the edit wins, the note comes back
      const remote = await downloadNote(id)
      if (remote) await storeNote(remote, remoteRev)
    } else if (remoteRev || last) {
      // Was in Dropbox: leave a marker for other devices, then remove the note file
      if (!remoteDeleted.has(id)) {
        const marker = await encrypt(key, new TextEncoder().encode(JSON.stringify(deletion)))
        await upload(deletedPath(id), marker, 'overwrite')
      }
      await deleteFile(notePath(id))
      result.deleted++
    }
    // else: never synced, nothing to do in Dropbox
    done.add(id)
    await db.transaction('rw', db.deletions, db.synced, async () => {
      await db.deletions.delete(id)
      if (!remoteRev || remoteRev === last?.rev) await db.synced.delete(id)
    })
  }

  // ---------- 2. Notes deleted on the other device ----------

  for (const id of remoteDeleted) {
    const note = await db.notes.get(id)
    if (!note) continue
    if (isChangedLocally(note)) {
      // Edited here since the last sync: the edit wins. Upload it and remove the marker.
      await deleteFile(deletedPath(id))
      const remoteRev = remoteNotes.get(id)
      await uploadNote(note, remoteRev ? { update: remoteRev } : 'add')
    } else {
      await db.transaction('rw', db.notes, db.synced, async () => {
        await db.notes.delete(id)
        await db.synced.delete(id)
      })
      result.deleted++
    }
    done.add(id)
  }

  // ---------- 3. Notes in Dropbox ----------

  for (const [id, remoteRev] of remoteNotes) {
    if (done.has(id)) continue
    done.add(id)
    const local = await db.notes.get(id)
    const last = synced.get(id)

    if (!local) {
      // New from the other device
      const remote = await downloadNote(id)
      if (remote) await storeNote(remote, remoteRev)
      continue
    }

    const changedHere = isChangedLocally(local)
    const changedThere = last?.rev !== remoteRev

    if (!changedThere) {
      if (changedHere) await uploadNote(local, { update: remoteRev })
      continue
    }

    const remote = await downloadNote(id)
    if (!remote) continue
    if (!changedHere || remote.updatedAt === local.updatedAt) {
      await storeNote(remote, remoteRev)
      continue
    }

    // Changed on both sides: the newest keeps the note
    if (local.updatedAt >= remote.updatedAt) {
      const { device, ...older } = remote
      await saveConflictCopy(older, device)
      await uploadNote(local, { update: remoteRev })
    } else {
      await saveConflictCopy(local, deviceName())
      await storeNote(remote, remoteRev)
    }
  }

  // ---------- 4. New notes from this device (incl. conflict copies) ----------

  for (const note of await db.notes.toArray()) {
    // Not in Dropbox yet. (Or it was, but its file is gone without a marker: upload it again.)
    if (!done.has(note.id)) await uploadNote(note, 'add')
  }

  return result
}
