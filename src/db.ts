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

// The local database, stored in the browser/app (IndexedDB).
export const db = new Dexie('syncr') as Dexie & {
  notes: EntityTable<Note, 'id'>
}

db.version(1).stores({
  notes: 'id, updatedAt', // fields we can look up / sort by
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

// Custom title if set, otherwise the first non-empty line of the text.
export function noteTitle(note: Note): string {
  if (note.title) return note.title
  const firstLine = note.text.split('\n').find((line) => line.trim() !== '')
  return firstLine?.trim() || 'Untitled'
}
