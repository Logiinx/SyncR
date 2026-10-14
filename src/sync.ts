import { isTauri } from '@tauri-apps/api/core'
import { db, imageIds, noteTitle, type Note } from './db'
import { decrypt, encrypt, getKey } from './crypto'
import { deleteFile, download, listFiles, upload } from './dropbox'

// Two-way sync between this device and Dropbox. Everything in Dropbox is encrypted.
//   /notes/<id>        one file per note
//   /deleted/<id>      marker left when a note is deleted, so other devices delete it too
//   /attachments/<id>  one file per image (never changes, so no conflicts)
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
const attachmentPath = (id: string) => `/attachments/${id}`
const UNUSED_IMAGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const OLD_MARKER_MS = 90 * 24 * 60 * 60 * 1000 // 90 days

// Images are stored without their file type; the first bytes tell which format it is
function imageType(bytes: Uint8Array) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif'
  if (bytes[8] === 0x57 && bytes[9] === 0x45) return 'image/webp' // "RIFF....WEBP"
  return ''
}

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

  // Saves a downloaded note locally without changing its dates.
  // localUpdatedAt = the local version this sync compared against (undefined: no local note).
  // Skipped if the user deleted or edited the note while this sync was running, so their
  // change is never overwritten: the next sync sends the deletion, or makes a conflict copy.
  async function storeNote(remote: RemoteNote, rev: string, localUpdatedAt: number | undefined) {
    const { device: _, ...note } = remote
    const stored = await db.transaction('rw', db.notes, db.synced, db.deletions, async () => {
      if (await db.deletions.get(note.id)) return false
      if ((await db.notes.get(note.id))?.updatedAt !== localUpdatedAt) return false
      await db.notes.put(note)
      await db.synced.put({ id: note.id, rev, updatedAt: note.updatedAt })
      return true
    })
    if (stored) result.downloaded++
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
  const remoteDeleted = new Map<string, number>() // id -> when the marker was written
  const remoteAttachments = new Set<string>()
  const { files, cursor } = await listFiles()
  result.cursor = cursor
  for (const file of files) {
    const [, folder, id] = file.path.split('/')
    if (folder === 'notes') remoteNotes.set(id, file.rev)
    if (folder === 'deleted') remoteDeleted.set(id, file.modified)
    if (folder === 'attachments') remoteAttachments.add(id)
  }
  const synced = new Map((await db.synced.toArray()).map((s) => [s.id, s]))
  const isChangedLocally = (note: Note) => synced.get(note.id)?.updatedAt !== note.updatedAt
  const done = new Set<string>() // notes fully handled by an earlier step
  const imagesUsedHere = async () => new Set((await db.notes.toArray()).flatMap((n) => imageIds(n.content)))
  const localAttachments = new Set(await db.attachments.toCollection().primaryKeys())

  // ---------- 0. Images used on this device that Dropbox doesn't have yet ----------
  // Before the notes, so a note in Dropbox never points to a missing image.
  // Images no note uses (e.g. pasted, then undone) aren't uploaded.

  for (const id of await imagesUsedHere()) {
    if (remoteAttachments.has(id) || !localAttachments.has(id)) continue
    const attachment = await db.attachments.get(id)
    if (!attachment) continue
    const encrypted = await encrypt(key, new Uint8Array(await attachment.blob.arrayBuffer()))
    await upload(attachmentPath(id), encrypted, 'add') // already there (null) is fine too
    remoteAttachments.add(id)
  }

  // ---------- 1. Notes deleted on this device ----------

  for (const deletion of await db.deletions.toArray()) {
    const id = deletion.id
    const remoteRev = remoteNotes.get(id)
    const last = synced.get(id)
    if (remoteRev && last && remoteRev !== last.rev) {
      // Edited on the other device after our last sync: the edit wins, the note comes back
      await db.deletions.delete(id) // otherwise storeNote() would skip it
      const remote = await downloadNote(id)
      if (remote) await storeNote(remote, remoteRev, undefined)
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

  for (const id of remoteDeleted.keys()) {
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

  // Markers older than 90 days are removed: every device that synced since then has deleted
  // the note. (A device offline for longer would bring it back, as a normal note.)
  for (const [id, writtenAt] of remoteDeleted) {
    if (Date.now() - writtenAt > OLD_MARKER_MS) await deleteFile(deletedPath(id))
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
      if (remote) await storeNote(remote, remoteRev, undefined)
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
      await storeNote(remote, remoteRev, local.updatedAt)
      continue
    }

    // Changed on both sides: the newest keeps the note
    if (local.updatedAt >= remote.updatedAt) {
      const { device, ...older } = remote
      await saveConflictCopy(older, device)
      await uploadNote(local, { update: remoteRev })
    } else {
      await saveConflictCopy(local, deviceName())
      await storeNote(remote, remoteRev, local.updatedAt)
    }
  }

  // ---------- 4. New notes from this device (incl. conflict copies) ----------

  for (const note of await db.notes.toArray()) {
    // Not in Dropbox yet. (Or it was, but its file is gone without a marker: upload it again.)
    if (!done.has(note.id)) await uploadNote(note, 'add')
  }

  // ---------- 5. Images used in notes that this device doesn't have yet ----------
  // Checks all notes, so an image that wasn't in Dropbox yet last time arrives now.
  // `used` is shared with step 6 (this step doesn't change notes). An edit made meanwhile
  // only affects the unused mark, and the next sync corrects it.

  const used = await imagesUsedHere()
  for (const id of used) {
    if (localAttachments.has(id) || !remoteAttachments.has(id)) continue
    const raw = await download(attachmentPath(id))
    if (!raw) continue
    const bytes = await decrypt(key, raw)
    await db.attachments.put({ id, blob: new Blob([bytes], { type: imageType(bytes) }), createdAt: Date.now() })
    localAttachments.add(id)
    // Open notes show it right away (see image.ts)
    window.dispatchEvent(new Event('attachments-changed'))
  }

  // ---------- 6. Clean up images no note uses anymore ----------
  // Deleted here and in Dropbox once no note on this device has used them for a week.
  // The wait keeps Undo working and gives other devices time to sync. If another device
  // still uses the image, it uploads it again (step 0).

  const now = Date.now()
  for (const attachment of await db.attachments.toArray()) {
    const { id, unusedSince } = attachment
    if (used.has(id)) {
      if (unusedSince) await db.attachments.update(id, { unusedSince: undefined })
    } else if (!unusedSince) {
      await db.attachments.update(id, { unusedSince: now })
    } else if (now - unusedSince > UNUSED_IMAGE_MS) {
      if (remoteAttachments.has(id)) await deleteFile(attachmentPath(id))
      await db.attachments.delete(id)
    }
  }

  return result
}
