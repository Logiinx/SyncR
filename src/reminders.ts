import { changed, db, type Reminder } from './db'

// Reminders: their own list, separate from notes (see DECISIONS.md, "Reminders").
// Every change sets updatedAt, so sync sends it to the other devices (sync.ts, step 4c).

const DAY_MS = 24 * 60 * 60 * 1000
const OLD_DELETED_MS = 90 * DAY_MS // like note deletion markers in sync.ts

export type ReminderFields = Pick<Reminder, 'text' | 'note' | 'dueAt' | 'phone'>

// Reminders that aren't deleted, soonest first
export async function listReminders(): Promise<Reminder[]> {
  const all = await db.reminders.toArray()
  return all.filter((r) => !r.deleted).sort((a, b) => a.dueAt - b.dueAt)
}

export async function addReminder(fields: ReminderFields): Promise<string> {
  const now = Date.now()
  const id = crypto.randomUUID()
  await db.reminders.add({ ...fields, id, doneAt: null, deleted: false, createdAt: now, updatedAt: now })
  changed()
  return id
}

async function update(id: string, changes: Partial<Reminder>) {
  await db.reminders.update(id, { ...changes, updatedAt: Date.now() })
  changed()
}

export const editReminder = (id: string, fields: ReminderFields) => update(id, fields)
export const markDone = (id: string) => update(id, { doneAt: Date.now() })
export const markNotDone = (id: string) => update(id, { doneAt: null })

// Moves the reminder to `minutes` from now and makes it wait again
export const snooze = (id: string, minutes: number) =>
  update(id, { dueAt: Date.now() + minutes * 60 * 1000, doneAt: null })

// "Tomorrow" snooze: the reminder's own time of day, tomorrow (18:00 clicked at 18:05 →
// 18:00 tomorrow). setDate() keeps the clock time across daylight saving changes.
export async function snoozeTomorrow(id: string) {
  const reminder = await db.reminders.get(id)
  if (!reminder) return
  const due = new Date(reminder.dueAt)
  const next = new Date()
  next.setHours(due.getHours(), due.getMinutes(), 0, 0)
  next.setDate(next.getDate() + 1)
  await update(id, { dueAt: next.getTime(), doneAt: null })
}

// Keeps the row (text emptied for privacy) so the deletion syncs; removed later by cleanUp()
export const deleteReminder = (id: string) => update(id, { deleted: true, text: '', note: '' })

export async function clearDone() {
  const done = (await listReminders()).filter((r) => r.doneAt !== null)
  for (const r of done) await deleteReminder(r.id)
}

// Deleted rows older than 90 days: every device that synced since then has them too.
// Returns the ids, so sync can remove their files from Dropbox.
export async function removeOldDeleted(): Promise<string[]> {
  const old = (await db.reminders.toArray()).filter(
    (r) => r.deleted && Date.now() - r.updatedAt > OLD_DELETED_MS,
  )
  await db.reminders.bulkDelete(old.map((r) => r.id))
  return old.map((r) => r.id)
}
