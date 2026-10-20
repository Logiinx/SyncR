import { changed, db, type Reminder } from './db'
import { openLink } from './links'

// Reminders: their own list, separate from notes (see DECISIONS.md, "Reminders").
// Every change sets updatedAt, so sync sends it to the other devices (sync.ts, step 4c).

const DAY_MS = 24 * 60 * 60 * 1000
const OLD_DELETED_MS = 90 * DAY_MS // like note deletion markers in sync.ts

export const REMINDERS_TAB = 'reminders' // the Reminders tab's id among the open tabs (like GAMES_TAB)

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

// doneAt: null makes a done reminder wait again (e.g. when it was moved to a new time)
export const editReminder = (id: string, fields: ReminderFields & { doneAt?: null }) => update(id, fields)
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

// ---------- Google Calendar (the phone's notification, see DECISIONS.md) ----------

// "20261015T160000Z": the time in UTC, as Google Calendar links want it
const calendarTime = (time: number) => new Date(time).toISOString().replace(/[-:]|\.\d{3}/g, '')

// Opens Google Calendar with the event filled in; the user taps Save there. One way only:
// later changes in SyncR don't reach the event. Opened in the browser (desktop app) or a
// new tab, so it must be called right after a click (otherwise the browser may block it).
export function addToGoogleCalendar(reminder: Pick<Reminder, 'text' | 'note' | 'dueAt'>) {
  const url = new URL('https://calendar.google.com/calendar/render')
  url.searchParams.set('action', 'TEMPLATE')
  url.searchParams.set('text', reminder.text)
  // A 15-minute event starting at the reminder's time
  url.searchParams.set('dates', `${calendarTime(reminder.dueAt)}/${calendarTime(reminder.dueAt + 15 * 60 * 1000)}`)
  if (reminder.note) url.searchParams.set('details', reminder.note)
  openLink(url.href)
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

// "Today, 18:00", "Tomorrow, 09:00", "Yesterday, 14:30", otherwise "17-10-2026, 14:00".
// allDay (an all-day calendar event): without the time, e.g. "Today", "17-10-2026".
export function formatDue(time: number, allDay = false) {
  const date = new Date(time)
  const pad = (n: number) => String(n).padStart(2, '0')
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const day = new Date(time).setHours(0, 0, 0, 0)
  const ref = new Date()
  ref.setHours(0, 0, 0, 0)
  const dayFromToday = (offset: number) => new Date(ref).setDate(ref.getDate() + offset)
  const at = allDay ? '' : `, ${clock}`
  if (day === dayFromToday(0)) return `Today${at}`
  if (day === dayFromToday(1)) return `Tomorrow${at}`
  if (day === dayFromToday(-1)) return `Yesterday${at}`
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}${at}`
}
