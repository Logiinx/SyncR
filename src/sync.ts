import type { Table, UpdateSpec } from 'dexie'
import { t } from './i18n'
import {
  db,
  imageIds,
  noteTitle,
  removeOldAlertMarks,
  removeOldDeletedCards,
  removeOldDeletedGames, removeOldDeletedFollows, removeOldDeletedFolders, removeOldDeletedPlaylists,
  savePendingEdits,
  type Note,
} from './db'
import { decrypt, encrypt, getKey } from './crypto'
import { clockTime, shortDate } from './dates'
import { deviceName } from './device'
import { syncHistory } from './historySync'
import { blobFromBytes } from './sealing'
import { changesSince, deleteFile, download, isCursorReset, listFiles, ownWrites, upload, type Change, type FileInfo } from './dropbox'

// Two-way sync between this device and Dropbox. Everything in Dropbox is encrypted.
//   /notes/<id>        one file per note
//   /deleted/<id>      marker left when a note is deleted, so other devices delete it too
//   /attachments/<id>  one file per image (never changes, so no conflicts)
//   /settings/<name>   app-wide settings that follow you, e.g. the color rules (lower-case names)
//   /cards/<id>        one file per Board card (a deleted one stays as a row with deleted = true)
//   /games/<id>        one file per game in the Games tab (same as cards)
//   /alerts/<id>       one file per calendar alert marked Done or snoozed (eventAlerts.ts)
//   /videofollows/<id> one file per channel followed in the Video tab (same as cards)
//   /videomarks/<id>   one file per video opened or watched (never removed)
//   /addedvideos/<id>  one file per video added by its link (never removed)
//   /videofolders/<id> one file per folder in the Video tab (same as cards)
//   /videoplaylists/<id> one file per playlist in the Video tab (same as cards; its videos stay local)
//   /videoplaces/<id>  one file per video moved to a folder (never removed)
//   /history/<note id>/<details>  older versions of notes (noteHistory.ts, historySync.ts)
// (/reminders/ held SyncR's own reminders, replaced by Google Calendar events in v0.16; syncs up to
// v0.38 removed it.)
// Rules (see DECISIONS.md, "Sync plan"):
// - A note changed on one side only: that version is copied to the other side.
// - Changed on both sides: the newest keeps the note, the other becomes a conflict copy.
// - Deleted on one side but edited on the other: the edit wins, the note comes back.
// - Settings, cards and games changed on both sides: the newest wins (no conflict copy),
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
  unreadable: number // files in Dropbox that couldn't be decrypted or read: skipped (see readFile)
  cursor: string // Dropbox's "bookmark" for this sync, to wait for later changes
}

// Something changed in Dropbox during the sync. Trying again a bit later fixes it.
export class RetrySoonError extends Error {}


// The tables synced as one file per record (syncRecords below), in the order they sync.
// A new synced table only needs a line here (and its folder in the list at the top).
interface RecordFolder {
  folder: string
  sync: (remoteRevs: Map<string, string>, key: CryptoKey, result: SyncResult) => Promise<void>
}

function records<T extends SyncedRecord, TInsert>(
  folder: string,
  table: Table<T, string, TInsert>,
  options: {
    idOf?: (record: T) => string // its file name (default: its id)
    removeWhenGone?: boolean // see syncRecords
    removeOld?: () => Promise<string[]> // removes old deleted ones here, returns their ids
  } = {},
): RecordFolder {
  return {
    folder,
    async sync(remoteRevs, key, result) {
      // Old deleted ones disappear here (removeOld) and from Dropbox
      for (const id of (await options.removeOld?.()) ?? []) {
        if (remoteRevs.delete(id)) await deleteFile(`/${folder}/${id}`)
      }
      const idOf = options.idOf ?? (byId as unknown as (record: T) => string) // records without idOf have an id
      await syncRecords(table, folder, remoteRevs, key, result, idOf, options.removeWhenGone)
    },
  }
}

// A function, so the tables are read when sync runs (db is fully set up by then)
const recordFolders = (): RecordFolder[] => [
  // Settings (color rules, …): a setting missing in Dropbox is never removed here (settings aren't
  // deleted): it's kept, and sent again once it changes.
  records('settings', db.settings, { idOf: (setting) => setting.name, removeWhenGone: false }),
  // Board cards and games: changed on both sides means the newest wins. See syncRecords().
  records('cards', db.cards, { removeOld: removeOldDeletedCards }),
  records('games', db.games, { removeOld: removeOldDeletedGames }),
  // Calendar alerts marked Done or snoozed: no deleted rows, an old mark goes here and from
  // Dropbox, and other devices remove theirs when they see its file is gone.
  records('alerts', db.alertMarks, { removeOld: removeOldAlertMarks }),
  // Video tab: followed channels, marks, videos added by link (a follow's videos stay local)
  records('videofollows', db.videoFollows, { removeOld: removeOldDeletedFollows }),
  records('videomarks', db.videoMarks),
  records('addedvideos', db.addedVideos),
  records('videofolders', db.videoFolders, { removeOld: removeOldDeletedFolders }),
  records('videoplaces', db.videoPlaces),
  records('videoplaylists', db.videoPlaylists, { removeOld: removeOldDeletedPlaylists }),
]

// The folders sync reads each time (not history/: see noteHistory.ts)
const NOTE_FOLDERS = ['/notes', '/deleted', '/attachments']

// ---------- What's in Dropbox ----------
// This device keeps the file list of the synced folders, with Dropbox's bookmark (cursor) for
// that moment (db.remoteFiles, db.syncListing). A sync then only asks what changed since,
// usually one request instead of one listing per folder. The whole list is fetched again the
// first time, once a day (in case the saved one ever drifted), when Dropbox forgot the
// bookmark, or when the synced folders change (another app version).
// The list and its bookmark are saved together, only when a sync succeeds: a sync that fails
// or is cut short leaves the old pair, and the next one asks again from there.

const FULL_LISTING_MS = 24 * 60 * 60 * 1000

interface Listing {
  files: Map<string, FileInfo> // path -> file, synced folders only
  cursor: string
  listedAt: number
  folders: string
  full: boolean // fetched whole (saved by replacing), else changes since the saved one
  changes: Change[] // not full: what to apply to the saved list
}

// Only files right inside one of the synced folders count (not history/, crypto.json, …)
function inFolders(path: string, folders: string[]) {
  const slash = path.lastIndexOf('/')
  return slash > 0 && folders.includes(path.slice(0, slash))
}

function applyChanges(listing: Listing, changes: Change[], folders: string[]) {
  for (const change of changes) {
    if (change.rev === null && folders.includes(change.path)) {
      // A whole folder deleted: Dropbox reports only the folder
      for (const path of listing.files.keys()) {
        if (!path.startsWith(change.path + '/')) continue
        listing.files.delete(path)
        listing.changes.push({ path, rev: null, modified: 0 })
      }
      continue
    }
    if (!inFolders(change.path, folders)) continue
    if (change.rev === null) listing.files.delete(change.path)
    else listing.files.set(change.path, { path: change.path, rev: change.rev, modified: change.modified })
    listing.changes.push(change)
  }
}

async function remoteListing(folders: string[]): Promise<Listing> {
  const saved = await db.syncListing.get('listing')
  const folderList = folders.join(',')
  if (saved && saved.folders === folderList && Date.now() - saved.listedAt < FULL_LISTING_MS) {
    try {
      const { changes, cursor } = await changesSince(saved.cursor)
      const files = new Map((await db.remoteFiles.toArray()).map((file) => [file.path, file]))
      const listing: Listing = { files, cursor, listedAt: saved.listedAt, folders: folderList, full: false, changes: [] }
      applyChanges(listing, changes, folders)
      return listing
    } catch (e) {
      if (!isCursorReset(e)) throw e
    }
  }
  const { files, cursor } = await listFiles(folders)
  const map = new Map(files.map((file) => [file.path, file]))
  return { files: map, cursor, listedAt: Date.now(), folders: folderList, full: true, changes: [] }
}

function saveListing(listing: Listing) {
  return db.transaction('rw', db.remoteFiles, db.syncListing, async () => {
    if (listing.full) {
      await db.remoteFiles.clear()
      await db.remoteFiles.bulkPut([...listing.files.values()])
    } else {
      // Each changed file as it is now in the list: still there, or gone
      const paths = [...new Set(listing.changes.map((change) => change.path))]
      await db.remoteFiles.bulkDelete(paths.filter((path) => !listing.files.has(path)))
      await db.remoteFiles.bulkPut(paths.filter((path) => listing.files.has(path)).map((path) => listing.files.get(path)!))
    }
    await db.syncListing.put({ name: 'listing', cursor: listing.cursor, listedAt: listing.listedAt, folders: listing.folders })
  })
}

const notePath = (id: string) => `/notes/${id}`
const deletedPath = (id: string) => `/deleted/${id}`
const attachmentPath = (id: string) => `/attachments/${id}`
const UNUSED_IMAGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days, as long as note history keeps versions
const OLD_MARKER_MS = 90 * 24 * 60 * 60 * 1000 // 90 days

// A version that lost a conflict, kept as a note (see saveConflictCopy)
const conflictCopyId = (note: Note) => `${note.id}-c${note.updatedAt}`

// Images are stored without their file type; the first bytes tell which format it is
function imageType(bytes: Uint8Array) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif'
  if (bytes[8] === 0x57 && bytes[9] === 0x45) return 'image/webp' // "RIFF....WEBP"
  return ''
}

// Runs `handle` for each item, a few at a time, so downloads overlap (uploads and deletions still
// go one at a time, see dropbox.ts). Each item must not depend on another's outcome. After an
// error no new items start, the ones running finish, then the first error is thrown, so nothing
// of this sync is still running when it ends.
const AT_ONCE = 4

async function forEachAtOnce<T>(items: Iterable<T>, handle: (item: T) => Promise<void>) {
  const queue = [...items]
  const errors: unknown[] = [] // in the order they happened
  const worker = async () => {
    while (queue.length && !errors.length) {
      try {
        await handle(queue.shift()!)
      } catch (error) {
        errors.push(error)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, queue.length) }, worker))
  if (errors.length) throw errors[0]
}

let running = false

export async function syncNow(): Promise<SyncResult> {
  if (running) throw new Error(t('Sync is already running'))
  running = true
  try {
    return await runSync()
  } catch (e) {
    // Dropbox wasn't as expected: the next sync fetches the whole file list, in case the saved one is wrong
    if (e instanceof RetrySoonError) await db.syncListing.update('listing', { listedAt: 0 }).catch(() => {})
    throw e
  } finally {
    running = false
  }
}

async function runSync(): Promise<SyncResult> {
  const key = await getKey()
  if (!key) throw new Error(t('Enter your passphrase first'))
  const result: SyncResult = { uploaded: 0, downloaded: 0, deleted: 0, conflicts: 0, unreadable: 0, cursor: '' }

  // ---------- Encrypted read / write ----------

  async function uploadNote(note: Note, mode: 'add' | { update: string }) {
    const data: RemoteNote = { ...note, device: deviceName() }
    const encrypted = await encrypt(key!, new TextEncoder().encode(JSON.stringify(data)))
    const rev = await upload(notePath(note.id), encrypted, mode)
    if (!rev) throw new RetrySoonError(t('A note changed in Dropbox during sync'))
    await db.synced.put({ id: note.id, rev, updatedAt: note.updatedAt })
    result.uploaded++
  }

  // An unreadable note counts as missing: nothing here is changed or replaced because of it
  async function downloadNote(id: string): Promise<RemoteNote | null> {
    const remote = await readFile<RemoteNote>(notePath(id), key!, result)
    return remote === UNREADABLE ? null : remote
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
    return stored
  }

  // Keeps a version that lost a conflict, as a new note. Its id comes from the note and the
  // version's time, so a retry of the same conflict (the step after it failed or was skipped)
  // finds the copy already there instead of making a second one.
  // Returns 'new', 'existing' (made by the attempt that failed), or null (no copy: it's in
  // Dropbox already, or was deleted).
  async function saveConflictCopy(note: Note, device: string): Promise<'new' | 'existing' | null> {
    const id = conflictCopyId(note)
    if (remoteNotes.has(id) || remoteDeleted.has(id)) return null
    const when = `${shortDate(note.updatedAt)}, ${clockTime(note.updatedAt)}`
    const added = await db.transaction('rw', db.notes, db.deletions, async () => {
      if (await db.deletions.get(id)) return null
      if (await db.notes.get(id)) return false
      await db.notes.add({
        ...note,
        id,
        // i18n-ok: English in every language (user, 2026-11-09), so both devices name it the same
        title: `${noteTitle(note)} (conflict, ${device}, ${when})`,
        conflictOf: note.id, // for the comparison (ConflictCompare.tsx); syncs with the note
      })
      return true
    })
    if (added === null) return null
    // An existing one was made by the attempt that failed: still reported ("conflict copy created")
    result.conflicts++
    return added ? 'new' : 'existing'
  }

  // ---------- What's where ----------

  const remoteNotes = new Map<string, string>() // id -> rev
  const remoteDeleted = new Map<string, number>() // id -> when the marker was written
  const remoteAttachments = new Set<string>()
  const folders = recordFolders()
  const remoteRecords = new Map(folders.map(({ folder }) => [folder, new Map<string, string>()])) // folder -> id -> rev
  ownWrites.clear()
  const syncedFolders = [...NOTE_FOLDERS, ...folders.map(({ folder }) => `/${folder}`)]
  const listing = await remoteListing(syncedFolders)
  const cursor = listing.cursor
  result.cursor = cursor
  for (const file of listing.files.values()) {
    const [, folder, id] = file.path.split('/')
    if (folder === 'notes') remoteNotes.set(id, file.rev)
    else if (folder === 'deleted') remoteDeleted.set(id, file.modified)
    else if (folder === 'attachments') remoteAttachments.add(id)
    else remoteRecords.get(folder)?.set(id, file.rev)
  }
  const synced = new Map((await db.synced.toArray()).map((s) => [s.id, s]))
  const isChangedLocally = (note: Note) => synced.get(note.id)?.updatedAt !== note.updatedAt
  const done = new Set<string>() // notes fully handled by an earlier step
  const imagesUsedIn = (notes: Note[]) => new Set(notes.flatMap((n) => imageIds(n.content)))
  const localAttachments = new Set(await db.attachments.toCollection().primaryKeys())

  // ---------- 0. Images used on this device that Dropbox doesn't have yet ----------
  // Before the notes, so a note in Dropbox never points to a missing image.
  // Images no note uses (e.g. pasted, then undone) aren't uploaded.

  for (const id of imagesUsedIn(await db.notes.toArray())) {
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
  // A few notes at a time (each note is handled on its own)

  const toCheck = [...remoteNotes].filter(([id]) => !done.has(id))
  for (const [id] of toCheck) done.add(id)
  await forEachAtOnce(toCheck, async ([id, remoteRev]) => {
    // An edit still waiting for its autosave must count as a local change, or the downloaded
    // version would be stored, then overwritten by that save without a conflict copy
    await savePendingEdits()
    const local = await db.notes.get(id)
    const last = synced.get(id)

    if (!local) {
      // New from the other device
      const remote = await downloadNote(id)
      if (remote) await storeNote(remote, remoteRev, undefined)
      return
    }

    const changedHere = isChangedLocally(local)
    const changedThere = last?.rev !== remoteRev

    if (!changedThere) {
      if (changedHere) await uploadNote(local, { update: remoteRev })
      return
    }

    const remote = await downloadNote(id)
    if (!remote) return
    if (!changedHere || remote.updatedAt === local.updatedAt) {
      await storeNote(remote, remoteRev, local.updatedAt)
      return
    }

    // Changed on both sides: the newest keeps the note
    if (local.updatedAt >= remote.updatedAt) {
      const { device, ...older } = remote
      await saveConflictCopy(older, device)
      await uploadNote(local, { update: remoteRev })
    } else {
      const copy = await saveConflictCopy(local, deviceName())
      // Edited here while this sync ran: nothing replaced, so no copy needed (the next sync
      // compares again, with the newer edit)
      if (!(await storeNote(remote, remoteRev, local.updatedAt)) && copy) {
        if (copy === 'new') await db.notes.delete(conflictCopyId(local))
        result.conflicts--
      }
    }
  })

  // ---------- 4. New notes from this device (incl. conflict copies) ----------
  // The notes as they are now, read once for steps 4 to 6

  const notesNow = await db.notes.toArray()
  for (const note of notesNow) {
    // Not in Dropbox yet. (Or it was, but its file is gone without a marker: upload it again.)
    if (!done.has(note.id)) await uploadNote(note, 'add')
  }

  // ---------- 4b. Settings, cards, games, alerts, Video tab (recordFolders above) ----------

  for (const { folder, sync } of folders) await sync(remoteRecords.get(folder)!, key, result)

  // ---------- 4d. Note history (historySync.ts) ----------
  // Never stops the sync: what isn't sent now is sent next time.

  try {
    await syncHistory(key)
  } catch (e) {
    console.warn('Note history sync failed', e)
  }

  // ---------- 5. Images used in notes that this device doesn't have yet ----------
  // Checks all notes, so an image that wasn't in Dropbox yet last time arrives now.
  // `used` is shared with step 6 (neither step changes notes). An edit made since step 4 only
  // affects the unused mark, and the next sync corrects it.

  const used = imagesUsedIn(notesNow)
  const missing = [...used].filter((id) => !localAttachments.has(id) && remoteAttachments.has(id))
  await forEachAtOnce(missing, async (id) => {
    const raw = await download(attachmentPath(id))
    if (!raw) return
    let bytes: Uint8Array<ArrayBuffer>
    try {
      bytes = await decrypt(key, raw)
    } catch {
      result.unreadable++
      return
    }
    await db.attachments.put({ id, blob: blobFromBytes(bytes, imageType(bytes)), createdAt: Date.now() }) // see sealing.ts
    localAttachments.add(id)
    // Open notes show it right away (see image.ts)
    window.dispatchEvent(new Event('attachments-changed'))
  })

  // ---------- 6. Clean up images no note uses anymore ----------
  // Deleted here and in Dropbox once no note on this device has used them for 30 days.
  // The wait keeps Undo working, gives other devices time to sync, and keeps the images of
  // older versions in note history (kept 30 days too). If another device
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

  // ---------- 7. Skip our own changes when waiting for the next ones ----------
  // The cursor is from the listing, before this sync wrote anything, so Dropbox would report
  // our own writes as changes and start a second, useless sync. If everything changed since
  // then was written by us, the cursor moves on; anything else (the other device saved during
  // this sync) keeps the old one, so that change is still reported.

  // The saved file list moves on with the cursor (our writes added), so it always matches it.
  if (ownWrites.size) {
    try {
      const since = await changesSince(cursor)
      if (since.changes.every((change) => ownWrites.get(change.path) === change.rev)) {
        result.cursor = listing.cursor = since.cursor
        applyChanges(listing, since.changes, syncedFolders)
      }
    } catch {
      // Keep the old cursor: at worst one extra sync
    }
  }
  await saveListing(listing)

  return result
}

// A file in Dropbox that can't be decrypted or read (saved with another passphrase, put there by
// hand, …). Skipped and left as it is, so everything else still syncs; the user is told how many.
const UNREADABLE = Symbol('unreadable')

async function readFile<T>(path: string, key: CryptoKey, result: SyncResult): Promise<T | null | typeof UNREADABLE> {
  const raw = await download(path)
  if (!raw) return null
  try {
    return JSON.parse(new TextDecoder().decode(await decrypt(key, raw)))
  } catch {
    result.unreadable++
    return UNREADABLE
  }
}

// ---------- One file per record: settings, cards, games, … (step 4b) ----------

// What they have in common: syncedRev / syncedUpdatedAt remember what was synced last, and (not
// for settings) a deletion is a change like any other (deleted = true).
interface SyncedRecord {
  updatedAt: number
  deleted?: boolean
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

const byId = (record: { id: string }) => record.id

// Syncs one table with its Dropbox folder (one encrypted file per record, named by idOf).
// Changed on both sides: the newest wins, so "deleted here, edited there" also goes to the newest.
async function syncRecords<T extends SyncedRecord, TInsert>(
  table: Table<T, string, TInsert>,
  folder: string,
  remoteRevs: Map<string, string>, // id -> rev, from the Dropbox listing
  key: CryptoKey,
  result: SyncResult,
  idOf: (record: T) => string,
  removeWhenGone = true,
) {
  const path = (id: string) => `/${folder}/${id}`
  const locals = new Map((await table.toArray()).map((record) => [idOf(record), record]))
  const ids = new Set([...remoteRevs.keys(), ...locals.keys()])
  // A few records at a time (each record is handled on its own)
  await forEachAtOnce(ids, async (id) => {
    const local = locals.get(id)
    const remoteRev = remoteRevs.get(id)
    const changedHere = local !== undefined && local.updatedAt !== local.syncedUpdatedAt
    const changedThere = remoteRev !== undefined && remoteRev !== local?.syncedRev

    // Not in Dropbox, and deleted here, or synced before and unchanged (another device removed
    // an old deleted one): remove it here too. Otherwise it's new (or edited): uploaded below.
    if (removeWhenGone && local && !remoteRev && (local.deleted || (local.syncedRev && !changedHere))) {
      await db.transaction('rw', table, async () => {
        if ((await table.get(id))?.updatedAt === local.updatedAt) await table.delete(id)
      })
      return
    }
    if (!changedHere && !changedThere) return

    const remote = changedThere ? await readFile<T>(path(id), key, result) : null
    if (remote === UNREADABLE) return // left alone, not overwritten

    if (local && changedHere && (!remote || localWins(local, remote))) {
      // Send this device's version
      const { syncedRev: _r, syncedUpdatedAt: _u, ...data } = local
      const encrypted = await encrypt(key, new TextEncoder().encode(JSON.stringify(data)))
      const rev = await upload(path(id), encrypted, remoteRev ? { update: remoteRev } : 'add')
      if (!rev) throw new RetrySoonError(t('Something in /{folder} changed in Dropbox during sync', { folder }))
      await table.update(id, { syncedRev: rev, syncedUpdatedAt: local.updatedAt } as unknown as UpdateSpec<TInsert>)
      result.uploaded++
    } else if (remote && remoteRev) {
      // Take the other device's version, unless it was changed here while this sync ran
      const stored = await db.transaction('rw', table, async () => {
        if ((await table.get(id))?.updatedAt !== local?.updatedAt) return false
        await table.put({ ...remote, syncedRev: remoteRev, syncedUpdatedAt: remote.updatedAt } as unknown as TInsert)
        return true
      })
      if (stored) result.downloaded++
    }
  })
}
