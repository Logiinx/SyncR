import { isTauri } from '@tauri-apps/api/core'
import type { InsertType, Table, UpdateSpec } from 'dexie'
import {
  db,
  imageIds,
  noteTitle,
  removeOldDeletedCards,
  removeOldDeletedGames,
  savePendingEdits,
  type Note,
  type Setting,
} from './db'
import { removeOldDeleted } from './reminders'
import { decrypt, encrypt, getKey } from './crypto'
import { deleteFile, download, listFiles, upload } from './dropbox'

// Two-way sync between this device and Dropbox. Everything in Dropbox is encrypted.
//   /notes/<id>        one file per note
//   /deleted/<id>      marker left when a note is deleted, so other devices delete it too
//   /attachments/<id>  one file per image (never changes, so no conflicts)
//   /settings/<name>   app-wide settings that follow you, e.g. the color rules (lower-case names)
//   /reminders/<id>    one file per reminder (a deleted one stays as a row with deleted = true)
//   /cards/<id>        one file per Board card (same as reminders)
//   /games/<id>        one file per game in the Games tab (same as reminders)
// Rules (see DECISIONS.md, "Sync plan"):
// - A note changed on one side only: that version is copied to the other side.
// - Changed on both sides: the newest keeps the note, the other becomes a conflict copy.
// - Deleted on one side but edited on the other: the edit wins, the note comes back.
// - Settings, reminders, cards and games changed on both sides: the newest wins (no conflict copy),
//   except that a deletion beats an edit of a copy that hadn't seen it (see localWins).

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
const settingPath = (name: string) => `/settings/${name}`
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
      conflictOf: note.id, // for the comparison (ConflictCompare.tsx); syncs with the note
    })
    result.conflicts++
  }

  // ---------- What's where ----------

  const remoteNotes = new Map<string, string>() // id -> rev
  const remoteDeleted = new Map<string, number>() // id -> when the marker was written
  const remoteAttachments = new Set<string>()
  const remoteSettings = new Map<string, string>() // name -> rev
  const remoteReminders = new Map<string, string>() // id -> rev
  const remoteCards = new Map<string, string>() // id -> rev
  const remoteGames = new Map<string, string>() // id -> rev
  const { files, cursor } = await listFiles()
  result.cursor = cursor
  for (const file of files) {
    const [, folder, id] = file.path.split('/')
    if (folder === 'notes') remoteNotes.set(id, file.rev)
    if (folder === 'deleted') remoteDeleted.set(id, file.modified)
    if (folder === 'attachments') remoteAttachments.add(id)
    if (folder === 'settings') remoteSettings.set(id, file.rev)
    if (folder === 'reminders') remoteReminders.set(id, file.rev)
    if (folder === 'cards') remoteCards.set(id, file.rev)
    if (folder === 'games') remoteGames.set(id, file.rev)
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
      // Was in Dropbox: leave a marker for other devices, then remove the note file, only if
      // it's still the version listed above
      if (!remoteDeleted.has(id)) {
        const marker = await encrypt(key, new TextEncoder().encode(JSON.stringify(deletion)))
        await upload(deletedPath(id), marker, 'overwrite')
      }
      if (remoteRev && !(await deleteFile(notePath(id), remoteRev))) {
        // Edited on the other device a moment ago (after the listing): the edit wins after all.
        // Not marked done: step 3 downloads it (with the listing's older rev, so the next sync
        // downloads it once more and stores the right rev).
        await deleteFile(deletedPath(id))
        await db.transaction('rw', db.deletions, db.synced, async () => {
          await db.deletions.delete(id)
          await db.synced.delete(id)
        })
        continue
      }
      if (!remoteRev) await deleteFile(notePath(id))
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
    // An edit still waiting for its autosave counts as an edit (it beats the deletion)
    await savePendingEdits()
    const note = await db.notes.get(id)
    if (!note) continue
    if (isChangedLocally(note)) {
      // Edited here since the last sync: the edit wins. Upload it and remove the marker.
      await deleteFile(deletedPath(id))
      const remoteRev = remoteNotes.get(id)
      await uploadNote(note, remoteRev ? { update: remoteRev } : 'add')
    } else {
      // Unless it was edited here while this sync ran: then the next sync sends the edit
      const deleted = await db.transaction('rw', db.notes, db.synced, async () => {
        if ((await db.notes.get(id))?.updatedAt !== note.updatedAt) return false
        await db.notes.delete(id)
        await db.synced.delete(id)
        return true
      })
      if (deleted) result.deleted++
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
    // An edit still waiting for its autosave must count as a local change, or the downloaded
    // version would be stored, then overwritten by that save without a conflict copy
    await savePendingEdits()
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

  // ---------- 4b. Settings (color rules, …) ----------
  // Like a note, but changed on both sides means the newest wins.

  const localSettings = await db.settings.toArray()
  const settingNames = new Set([...remoteSettings.keys(), ...localSettings.map((s) => s.name)])
  for (const name of settingNames) {
    const local = localSettings.find((s) => s.name === name)
    const remoteRev = remoteSettings.get(name)
    const changedHere = local !== undefined && local.updatedAt !== local.syncedUpdatedAt
    const changedThere = remoteRev !== undefined && remoteRev !== local?.syncedRev
    if (!changedHere && !changedThere) continue

    let remote: Setting | null = null
    if (changedThere) {
      const raw = await download(settingPath(name))
      if (raw) remote = JSON.parse(new TextDecoder().decode(await decrypt(key, raw)))
    }

    if (local && changedHere && (!remote || local.updatedAt >= remote.updatedAt)) {
      // Send this device's version
      const data: Setting = { name, value: local.value, updatedAt: local.updatedAt }
      const encrypted = await encrypt(key, new TextEncoder().encode(JSON.stringify(data)))
      const rev = await upload(settingPath(name), encrypted, remoteRev ? { update: remoteRev } : 'add')
      if (!rev) throw new RetrySoonError('A setting changed in Dropbox during sync.')
      await db.settings.update(name, { syncedRev: rev, syncedUpdatedAt: local.updatedAt })
      result.uploaded++
    } else if (remote && remoteRev) {
      // Take the other device's version, unless it was changed here while this sync ran
      const stored = await db.transaction('rw', db.settings, async () => {
        if ((await db.settings.get(name))?.updatedAt !== local?.updatedAt) return false
        await db.settings.put({ ...remote, syncedRev: remoteRev, syncedUpdatedAt: remote.updatedAt })
        return true
      })
      if (stored) result.downloaded++
    }
  }

  // ---------- 4c. Reminders, Board cards and games ----------
  // Like settings: changed on both sides means the newest wins. See syncRecords().

  // Deleted ones older than 90 days disappear here and from Dropbox
  for (const id of await removeOldDeleted()) {
    if (remoteReminders.delete(id)) await deleteFile(`/reminders/${id}`)
  }
  for (const id of await removeOldDeletedCards()) {
    if (remoteCards.delete(id)) await deleteFile(`/cards/${id}`)
  }
  await syncRecords(db.reminders, 'reminders', remoteReminders, key, result)
  for (const id of await removeOldDeletedGames()) {
    if (remoteGames.delete(id)) await deleteFile(`/games/${id}`)
  }
  await syncRecords(db.cards, 'cards', remoteCards, key, result)
  await syncRecords(db.games, 'games', remoteGames, key, result)

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

// ---------- Reminders and cards (step 4c) ----------

// What reminders, Board cards and games have in common: a deletion is a change like any other
// (deleted = true), and syncedRev / syncedUpdatedAt remember what was synced last.
interface SyncedRecord {
  id: string
  updatedAt: number
  deleted: boolean
  restoredAt?: number // when a deleted record was deliberately brought back (re-added, Undo)
  syncedRev?: string
  syncedUpdatedAt?: number
}

// Changed on both sides: which one stays? The newest, except for deletions: a deletion wins
// over an edit made on a device that hadn't received it yet (e.g. "Done" clicked on an old copy
// of a reminder that was deleted elsewhere). Only a deliberate restore made after the deletion
// (restoredAt, e.g. a removed game added again) beats it.
export function localWins(local: SyncedRecord, remote: SyncedRecord) {
  if (remote.deleted && !local.deleted) return (local.restoredAt ?? 0) > remote.updatedAt
  if (local.deleted && !remote.deleted) return (remote.restoredAt ?? 0) <= local.updatedAt
  return local.updatedAt >= remote.updatedAt
}

// Syncs one table with its Dropbox folder (one encrypted file per record).
// Changed on both sides: the newest wins, so "deleted here, edited there" also goes to the newest.
async function syncRecords<T extends SyncedRecord>(
  table: Table<T, string, InsertType<T, 'id'>>,
  folder: string,
  remoteRevs: Map<string, string>, // id -> rev, from the Dropbox listing
  key: CryptoKey,
  result: SyncResult,
) {
  const path = (id: string) => `/${folder}/${id}`
  const locals = await table.toArray()
  const ids = new Set([...remoteRevs.keys(), ...locals.map((r) => r.id)])
  for (const id of ids) {
    const local = locals.find((r) => r.id === id)
    const remoteRev = remoteRevs.get(id)
    const changedHere = local !== undefined && local.updatedAt !== local.syncedUpdatedAt
    const changedThere = remoteRev !== undefined && remoteRev !== local?.syncedRev

    // Not in Dropbox, and deleted here, or synced before and unchanged (another device removed
    // an old deleted one): remove it here too. Otherwise it's new (or edited): uploaded below.
    if (local && !remoteRev && (local.deleted || (local.syncedRev && !changedHere))) {
      await db.transaction('rw', table, async () => {
        if ((await table.get(id))?.updatedAt === local.updatedAt) await table.delete(id)
      })
      continue
    }
    if (!changedHere && !changedThere) continue

    let remote: T | null = null
    if (changedThere) {
      const raw = await download(path(id))
      if (raw) remote = JSON.parse(new TextDecoder().decode(await decrypt(key, raw)))
    }

    if (local && changedHere && (!remote || localWins(local, remote))) {
      // Send this device's version
      const { syncedRev: _r, syncedUpdatedAt: _u, ...data } = local
      const encrypted = await encrypt(key, new TextEncoder().encode(JSON.stringify(data)))
      const rev = await upload(path(id), encrypted, remoteRev ? { update: remoteRev } : 'add')
      if (!rev) throw new RetrySoonError(`Something in /${folder} changed in Dropbox during sync.`)
      await table.update(id, { syncedRev: rev, syncedUpdatedAt: local.updatedAt } as unknown as UpdateSpec<InsertType<T, 'id'>>)
      result.uploaded++
    } else if (remote && remoteRev) {
      // Take the other device's version, unless it was changed here while this sync ran
      const stored = await db.transaction('rw', table, async () => {
        if ((await table.get(id))?.updatedAt !== local?.updatedAt) return false
        await table.put({ ...remote, syncedRev: remoteRev, syncedUpdatedAt: remote.updatedAt })
        return true
      })
      if (stored) result.downloaded++
    }
  }
}
