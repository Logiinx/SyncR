import { db, savePendingEdits, watchNoteEdits, type Note, type Snapshot } from './db'
import { deviceName } from './device'

// Note history: older versions of each note ("snapshots"), saved at moments that matter
// instead of at every autosave (see DECISIONS.md, "Note history"):
// - when an editing session ends: no edit for 5 min, the note closed, the app hidden or closed
//   (a session the app never got to end, e.g. the phone killed it, ends at the next start);
// - every 30 min during a long session;
// - right before a big deletion (a lot of text gone in one save), protected;
// - at the end of a session that removed a lot in total (bit by bit), the version from before
//   the session is protected too.
// A session's first edit also saves the version from before it, if this device has no
// snapshot of it yet (the first edit after this feature came, or an edit from the other device).
// Snapshots are saved on this device first (db.snapshots), sync uploads them. Conflict copies
// have no history.

const IDLE_MS = 5 * 60 * 1000
const LONG_SESSION_MS = 30 * 60 * 1000
const SESSIONS_KEY = 'syncr.history.sessions'

// A lot of text gone: 30+ words, or 10+ words that were at least a third of the note
const BIG_WORDS = 30
const BIG_MIN_WORDS = 10

interface Session {
  baseId?: string // the snapshot of the version from before the session (none: it was empty)
  lastEditAt: number
  lastSnapshotAt: number
}

// Kept in localStorage, so a session cut short by a crash still ends properly at the next start
let sessions: Record<string, Session> = loadSessions()
const idleTimers = new Map<string, number>()

function loadSessions(): Record<string, Session> {
  try {
    return JSON.parse(localStorage.getItem(SESSIONS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function saveSessions() {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions))
}

// One change at a time, in order (saves arrive while the previous one is still being handled).
// A failure is only logged: history must never stop a note from being saved.
let queue: Promise<void> = Promise.resolve()

function inOrder(work: () => Promise<void>): Promise<void> {
  queue = queue.then(work).catch((e) => console.warn('Note history failed', e))
  return queue
}

// ---------- Comparing versions ----------

function words(text: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const word of text.toLowerCase().split(/\s+/)) {
    if (word) counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  return counts
}

// Words in `before` that aren't in `after` (a word that was there twice and is now once counts once)
function removedWords(before: string, after: string) {
  const left = words(after)
  let removed = 0
  for (const [word, count] of words(before)) removed += Math.max(0, count - (left.get(word) ?? 0))
  return removed
}

function wordCount(text: string) {
  return text.split(/\s+/).filter(Boolean).length
}

function isBigDeletion(before: string, after: string) {
  const removed = removedWords(before, after)
  return removed >= BIG_WORDS || (removed >= BIG_MIN_WORDS && removed * 3 >= wordCount(before))
}

async function hashOf(note: Pick<Note, 'title' | 'content'>) {
  const data = new TextEncoder().encode(JSON.stringify([note.title, note.content]))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
  return Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('')
}

const isEmpty = (note: Note) => !note.text.trim() && !note.title

// ---------- Saving snapshots ----------

// This device's newest snapshot of the note
async function latestSnapshot(noteId: string): Promise<Snapshot | undefined> {
  const all = await db.snapshots.where('noteId').equals(noteId).sortBy('savedAt')
  return all[all.length - 1]
}

// Saves the note as it is now, unless it's empty or the same as this device's newest snapshot
// (then that one is returned, protected if asked). Returns the snapshot (none: empty note).
async function snapshot(note: Note, protect = false): Promise<Snapshot | undefined> {
  if (isEmpty(note)) return undefined
  const hash = await hashOf(note)
  const latest = await latestSnapshot(note.id)
  if (latest?.hash === hash) {
    if (protect && !latest.protected) await db.snapshots.update(latest.id, { protected: true, uploaded: 0 })
    return latest
  }
  // Never two snapshots of one note in the same millisecond (the id would be the same)
  const savedAt = Math.max(Date.now(), (latest?.savedAt ?? 0) + 1)
  const row: Snapshot = {
    id: `${note.id}-${savedAt}`,
    noteId: note.id,
    savedAt,
    title: note.title,
    content: note.content,
    text: note.text,
    hash,
    device: deviceName(),
    added: latest ? removedWords(note.text, latest.text) : wordCount(note.text),
    removed: latest ? removedWords(latest.text, note.text) : 0,
    protected: protect,
    uploaded: 0,
  }
  await db.snapshots.put(row)
  return row
}

// ---------- Sessions ----------

function restartIdleTimer(noteId: string) {
  window.clearTimeout(idleTimers.get(noteId))
  idleTimers.set(noteId, window.setTimeout(() => endSession(noteId), IDLE_MS))
}

async function noteEdited(before: Note, after: Note | null) {
  if (before.conflictOf) return
  await inOrder(async () => {
    const now = Date.now()
    let session = sessions[before.id]
    if (!session) {
      // First edit of a session: keep the version from before it
      const base = await snapshot(before)
      session = { baseId: base?.id, lastEditAt: now, lastSnapshotAt: now }
    }

    if (!after) {
      // The note is deleted: its last version is kept, protected (for a trash later)
      await snapshot(before, true)
      delete sessions[before.id]
      window.clearTimeout(idleTimers.get(before.id))
      saveSessions()
      return
    }

    if (isBigDeletion(before.text, after.text)) {
      await snapshot(before, true)
      session.lastSnapshotAt = now
    } else if (now - session.lastSnapshotAt >= LONG_SESSION_MS) {
      await snapshot(after)
      session.lastSnapshotAt = now
    }
    session.lastEditAt = now
    sessions[before.id] = session
    saveSessions()
  })
  if (after) restartIdleTimer(before.id)
}

// Ends a note's editing session: saves the version it ended with, and protects the version from
// before it if the session removed a lot in total.
export function endSession(noteId: string): Promise<void> {
  window.clearTimeout(idleTimers.get(noteId))
  idleTimers.delete(noteId)
  return inOrder(async () => {
    const session = sessions[noteId]
    if (!session) return
    const note = await db.notes.get(noteId)
    if (note) {
      const base = session.baseId ? await db.snapshots.get(session.baseId) : undefined
      if (base && isBigDeletion(base.text, note.text) && !base.protected) {
        await db.snapshots.update(base.id, { protected: true, uploaded: 0 })
      }
      await snapshot(note)
    }
    // Only now: if the app is closed before the snapshot is saved, the next start ends it again
    delete sessions[noteId]
    saveSessions()
  })
}

// Ends every open session, after saving edits still waiting in an editor. Before the app is
// hidden or closed (autoSync.ts finalSync), so the last version is there for the next sync.
export async function endAllSessions() {
  await savePendingEdits()
  await Promise.all(Object.keys(sessions).map(endSession))
}

// ---------- What is kept ----------

const DAY_MS = 24 * 60 * 60 * 1000
const KEEP_ALL_MS = 2 * DAY_MS
export const KEEP_MS = 30 * DAY_MS

// Which versions of one note stay: all from the last 2 days, protected ones for 30 days, and the
// last one of each day for 30 days. Every device uses the same rule, so two devices cleaning up
// at the same time remove the same ones.
export function versionsToKeep<T extends { savedAt: number; protected: boolean }>(versions: T[], now = Date.now()) {
  const keep = new Set<T>()
  const days = new Set<string>()
  for (const version of [...versions].sort((a, b) => b.savedAt - a.savedAt)) {
    const age = now - version.savedAt
    if (age > KEEP_MS) continue
    const day = new Date(version.savedAt).toDateString()
    if (age <= KEEP_ALL_MS || version.protected || !days.has(day)) keep.add(version)
    days.add(day)
  }
  return keep
}

// Removes the snapshots this device doesn't need anymore. Uploaded ones are in Dropbox, so only
// the newest of each note stays (the next one is compared with it), and those an open session
// started from. Ones not uploaded (Dropbox not set up) follow the keep rule.
export function cleanUpSnapshots() {
  return inOrder(async () => {
    const now = Date.now()
    const bases = new Set(Object.values(sessions).map((session) => session.baseId))
    const byNote = new Map<string, Snapshot[]>()
    for (const row of await db.snapshots.toArray()) byNote.set(row.noteId, [...(byNote.get(row.noteId) ?? []), row])
    const remove: string[] = []
    for (const rows of byNote.values()) {
      const latest = rows.reduce((a, b) => (b.savedAt > a.savedAt ? b : a))
      const kept = versionsToKeep(rows.filter((row) => !row.uploaded), now)
      for (const row of rows) {
        const needed = bases.has(row.id) || (now - row.savedAt <= KEEP_MS && (row === latest || kept.has(row)))
        if (!needed) remove.push(row.id)
      }
    }
    await db.snapshots.bulkDelete(remove)
  })
}

// Started once by the app
let started = false
export function startNoteHistory() {
  if (started) return
  started = true
  watchNoteEdits(noteEdited)
  // Sessions the app couldn't end last time (closed suddenly)
  for (const noteId of Object.keys(sessions)) void endSession(noteId)
  void cleanUpSnapshots()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void endAllSessions()
  })
}
