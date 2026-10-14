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

// The local database, stored in the browser/app (IndexedDB).
export const db = new Dexie('syncr') as Dexie & {
  notes: EntityTable<Note, 'id'>
  deletions: EntityTable<Deletion, 'id'>
  keys: EntityTable<StoredKey, 'name'>
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

export async function createNote(): Promise<string> {
  const now = Date.now()
  const id = crypto.randomUUID()
  await db.notes.add({ id, title: null, content: null, text: '', createdAt: now, updatedAt: now })
  return id
}

export async function saveNoteContent(id: string, content: JSONContent, text: string) {
  await db.notes.update(id, { content, text, updatedAt: Date.now() })
}

// Empty title = go back to the automatic title (first line).
export async function renameNote(id: string, title: string) {
  await db.notes.update(id, { title: title.trim() || null, updatedAt: Date.now() })
}

export async function deleteNote(id: string) {
  await db.transaction('rw', db.notes, db.deletions, async () => {
    await db.notes.delete(id)
    await db.deletions.put({ id, deletedAt: Date.now() })
  })
}

// Custom title if set, otherwise the first non-empty line of the text.
export function noteTitle(note: Note): string {
  if (note.title) return note.title
  const firstLine = note.text.split('\n').find((line) => line.trim() !== '')
  return firstLine?.trim() || 'Untitled'
}
