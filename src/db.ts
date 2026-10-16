import Dexie, { type EntityTable } from 'dexie'
import type { JSONContent } from '@tiptap/react'

export interface Note {
  id: string
  title: string | null // custom title; null = use the first line
  content: JSONContent | null // editor document
  text: string // plain-text copy, used for the title fallback and (later) search
  createdAt: number
  updatedAt: number
  conflictOf?: string // a conflict copy (sync.ts): the id of the note it is a copy of
}

// Marker left behind when a note is deleted, so sync can delete it on the other device too.
export interface Deletion {
  id: string // the deleted note's id
  deletedAt: number
}

// The sync encryption key, remembered on this device (see crypto.ts). Never synced.
export interface StoredKey {
  name: string // always 'sync' for now
  key: CryptoKey
}

// What a note looked like at the last sync (see sync.ts). A note whose updatedAt differs
// from this has local changes. "rev" is Dropbox's version of the file.
export interface SyncedNote {
  id: string
  rev: string
  updatedAt: number
}

// An image in a note. The note only stores the id; the image data lives here.
// Never changes once added (a new image gets a new id).
export interface Attachment {
  id: string
  blob: Blob // the image file (PNG, JPEG, …)
  createdAt: number
  unusedSince?: number // set when sync first finds no note using it (see sync.ts, step 6)
}

// App-wide data that syncs like a note (e.g. the color rules, see colorRules.ts).
// One row per kind, found by name (lower case only: it's also the file name in Dropbox,
// which lists names in lower case). syncedRev / syncedUpdatedAt: what it looked like at the
// last sync (like SyncedNote for notes).
export interface Setting {
  name: string
  value: unknown
  updatedAt: number
  syncedRev?: string
  syncedUpdatedAt?: number
}

// A reminder (see reminders.ts). Separate from notes, synced like a setting: changed on both
// sides means the newest wins. A deleted reminder stays as a row with deleted = true for a
// while, so the deletion syncs like any other change (see sync.ts, step 4c).
// syncedRev / syncedUpdatedAt: what it looked like at the last sync.
export interface Reminder {
  id: string
  text: string
  note: string // optional longer text ('' = none)
  dueAt: number // when to remind (ms since 1970); snoozing moves it
  phone: boolean // also added to Google Calendar
  doneAt: number | null // null = still waiting
  deleted: boolean
  createdAt: number
  updatedAt: number
  syncedRev?: string
  syncedUpdatedAt?: number
}

// A card on the Board (Board.tsx): a small note shown beside whatever note is open.
// Like a reminder: synced like a setting (newest wins), and a deleted card stays as a row
// with deleted = true for a while, so the deletion can sync too (and "Undo" can bring it back).
// order: position in the list; a new card gets the highest, so it lands at the bottom of its
// part (priority cards are always shown above the others).
export interface Card {
  id: string
  content: JSONContent | null // editor document, like a note's
  text: string // plain-text copy
  priority: boolean
  order: number
  deleted: boolean
  createdAt: number
  updatedAt: number
  syncedRev?: string
  syncedUpdatedAt?: number
}

// A game in the Games tab (GamesView.tsx), with its data from IGDB (igdb.ts).
// Synced like a card: one file per game, newest wins, a removed game stays as a row with
// deleted = true for a while. The id comes from IGDB's, so a game can't be in the list twice.
export type GameStatus = 'waiting' | 'toplay' | 'playing' | 'done' | 'dropped'

export interface Game {
  id: string // "igdb-<IGDB id>"
  igdbId: number
  name: string
  coverId?: string // IGDB image id (covers load from IGDB's image server, never stored)
  releaseDate?: number // first release, ms; missing = not announced (TBA)
  platforms: string[] // short names, e.g. "PC", "Android"
  status: GameStatus
  statusAt: number // when it got this status (sorts the groups: newest first, e.g. last finished)
  priority: boolean // flag: top of its group
  note: string // any time, optional
  review: string // with the rating, optional
  rating?: number // 0.5 to 5, in half stars
  liked: boolean // the heart
  deleted: boolean
  createdAt: number
  updatedAt: number
  syncedRev?: string
  syncedUpdatedAt?: number
}

// The local database, stored in the browser/app (IndexedDB).
export const db = new Dexie('syncr') as Dexie & {
  notes: EntityTable<Note, 'id'>
  deletions: EntityTable<Deletion, 'id'>
  keys: EntityTable<StoredKey, 'name'>
  synced: EntityTable<SyncedNote, 'id'>
  attachments: EntityTable<Attachment, 'id'>
  settings: EntityTable<Setting, 'name'>
  reminders: EntityTable<Reminder, 'id'>
  cards: EntityTable<Card, 'id'>
  games: EntityTable<Game, 'id'>
}

db.version(1).stores({
  notes: 'id, updatedAt', // fields we can look up / sort by
})

db.version(2).stores({
  deletions: 'id',
})

db.version(3).stores({
  keys: 'name',
})

db.version(4).stores({
  synced: 'id',
})

db.version(5).stores({
  attachments: 'id',
})

db.version(6).stores({
  settings: 'name',
})

db.version(7).stores({
  reminders: 'id',
})

db.version(8).stores({
  cards: 'id',
})

db.version(9).stores({
  games: 'id',
})

// Tells auto-sync (autoSync.ts) that the user changed something on this device.
// Sync's own writes don't call this, so they don't start another sync.
export function changed() {
  window.dispatchEvent(new Event('notes-changed'))
}

export async function createNote(): Promise<string> {
  const now = Date.now()
  const id = crypto.randomUUID()
  await db.notes.add({ id, title: null, content: null, text: '', createdAt: now, updatedAt: now })
  changed()
  return id
}

export async function saveNoteContent(id: string, content: JSONContent, text: string) {
  await db.notes.update(id, { content, text, updatedAt: Date.now() })
  changed()
}

// Empty title = go back to the automatic title (first line).
export async function renameNote(id: string, title: string) {
  await db.notes.update(id, { title: title.trim() || null, updatedAt: Date.now() })
  changed()
}

export async function deleteNote(id: string) {
  await db.transaction('rw', db.notes, db.deletions, async () => {
    await db.notes.delete(id)
    await db.deletions.put({ id, deletedAt: Date.now() })
  })
  changed()
}

// The ids of the images (attachments) used in a note
export function imageIds(content: JSONContent | null): string[] {
  const ids: string[] = []
  const walk = (node: JSONContent) => {
    if (node.type === 'image' && node.attrs?.id) ids.push(node.attrs.id)
    node.content?.forEach(walk)
  }
  if (content) walk(content)
  return ids
}

// Custom title if set, otherwise the first non-empty line of the text.
export function noteTitle(note: Note): string {
  if (note.title) return note.title
  const firstLine = note.text.split('\n').find((line) => line.trim() !== '')
  return firstLine?.trim() || 'Untitled'
}

// ---------- Board cards ----------
// Synced like reminders (sync.ts, step 4c). Every change calls changed() so auto-sync runs.

const OLD_DELETED_CARD_MS = 90 * 24 * 60 * 60 * 1000 // like reminders (reminders.ts)

// Higher than any card's order: a card given it lands at the bottom of its part.
// Deleted cards count too, so Undo puts a card back in its place.
async function nextOrder() {
  const all = await db.cards.toArray()
  return Math.max(0, ...all.map((card) => card.order)) + 1
}

// A new card at the bottom of its part: empty by default ("+"), or with content ("Pin")
export async function createCard(start?: {
  content: JSONContent
  text: string
  priority: boolean
}): Promise<string> {
  const now = Date.now()
  const id = crypto.randomUUID()
  const order = await nextOrder()
  await db.cards.add({
    id,
    content: start?.content ?? null,
    text: start?.text ?? '',
    priority: start?.priority ?? false,
    order,
    deleted: false,
    createdAt: now,
    updatedAt: now,
  })
  changed()
  return id
}

export async function saveCardContent(id: string, content: JSONContent, text: string) {
  await db.cards.update(id, { content, text, updatedAt: Date.now() })
  changed()
}

// Delete (deleted = true) or bring back (Undo)
export async function setCardDeleted(id: string, deleted: boolean) {
  await db.cards.update(id, { deleted, updatedAt: Date.now() })
  changed()
}

// Nothing typed in it (a fresh card, or everything erased)
export function isEmptyCard(card: Card): boolean {
  const blocks = card.content?.content
  return !blocks || (blocks.length === 1 && blocks[0].type === 'paragraph' && !blocks[0].content)
}

// Flag / unflag: the card moves to the bottom of its new part
export async function setCardPriority(id: string, priority: boolean) {
  await db.cards.update(id, { priority, order: await nextOrder(), updatedAt: Date.now() })
  changed()
}

// Deleted cards are kept for a while so the deletion syncs; after 90 days they go for good.
// Returns their ids, so sync can remove them from Dropbox too.
export async function removeOldDeletedCards(): Promise<string[]> {
  const old = (await db.cards.toArray()).filter(
    (card) => card.deleted && Date.now() - card.updatedAt > OLD_DELETED_CARD_MS,
  )
  await db.cards.bulkDelete(old.map((card) => card.id))
  return old.map((card) => card.id)
}

// Dropped somewhere else on the Board (drag and drop): new part and position
export async function moveCard(id: string, priority: boolean, order: number) {
  await db.cards.update(id, { priority, order, updatedAt: Date.now() })
  changed()
}

// ---------- Games ----------

// Removed games are kept for a while so the removal syncs; after 90 days they go for good.
export async function removeOldDeletedGames(): Promise<string[]> {
  const old = (await db.games.toArray()).filter(
    (game) => game.deleted && Date.now() - game.updatedAt > OLD_DELETED_CARD_MS,
  )
  await db.games.bulkDelete(old.map((game) => game.id))
  return old.map((game) => game.id)
}

export async function updateGame(id: string, change: Partial<Game>) {
  await db.games.update(id, { ...change, updatedAt: Date.now() })
  changed()
}

export async function setGameStatus(id: string, status: GameStatus) {
  await updateGame(id, { status, statusAt: Date.now() })
}
