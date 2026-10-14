import Dexie, { type EntityTable } from 'dexie'
import type { JSONContent } from '@tiptap/react'

export interface Note {
  id: string
  title: string | null // custom title; null = use the first line
  content: JSONContent | null // editor document
  text: string // plain-text copy, used for the title fallback and (later) search
  createdAt: number
  updatedAt: number
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

// The local database, stored in the browser/app (IndexedDB).
export const db = new Dexie('syncr') as Dexie & {
  notes: EntityTable<Note, 'id'>
  deletions: EntityTable<Deletion, 'id'>
  keys: EntityTable<StoredKey, 'name'>
  synced: EntityTable<SyncedNote, 'id'>
  attachments: EntityTable<Attachment, 'id'>
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

// Tells auto-sync (autoSync.ts) that the user changed something on this device.
// Sync's own writes don't call this, so they don't start another sync.
function changed() {
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
