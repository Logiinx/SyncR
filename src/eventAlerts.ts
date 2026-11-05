import { useLiveQuery } from 'dexie-react-hooks'
import { refreshEvents, updateEvent } from './calendarEvents'
import { alertMarkId, changed, db, type CalendarEvent } from './db'
import { clockTime } from './dates'

// The alerts of the Google Calendar events (calendarEvents.ts): each event's alert times
// (its own, or the calendar's default: CalendarEvent.alerts; all-day events: see alertsOf) come
// due and show in the pop-up / cards (dueReminders.ts). Done and Snooze are marks on the alert
// (db.alertMarks, synced to the other device); Snooze also moves the event in Google (snoozeAlert).

// ---------- Default alert for all-day events (Settings → Alerts, synced) ----------

// Google doesn't tell apps its default notification for all-day events (only the one for timed
// events), and an "on the day at 09:00" one isn't readable either: such events reach SyncR without
// any alert. An all-day event without alerts gets this one instead. Like Google: minutes before the
// day's start (midnight); negative = on the day itself.
const ALL_DAY_SETTING = 'all-day-alert' // lower case: Dropbox lists file names in lower case
const ALL_DAY_DEFAULT = -9 * 60 // on the day at 09:00
export const ALL_DAY_ALERTS = [null, -8 * 60, -9 * 60, -10 * 60, -12 * 60, 15 * 60, 6 * 60] // null = no alert

export async function loadAllDayAlert(): Promise<number | null> {
  const row = await db.settings.get(ALL_DAY_SETTING)
  return row ? (row.value as number | null) : ALL_DAY_DEFAULT
}

export async function saveAllDayAlert(minutes: number | null) {
  const change = { value: minutes, updatedAt: Date.now() }
  if (!(await db.settings.update(ALL_DAY_SETTING, change))) await db.settings.put({ name: ALL_DAY_SETTING, ...change })
  changed()
}

export const useAllDayAlert = () => useLiveQuery(loadAllDayAlert, [])

// The alerts SyncR uses for an event: its own, or for an all-day event without any, the setting's
export function alertsOf(event: CalendarEvent, allDayAlert: number | null | undefined): number[] {
  if (!event.allDay || event.alerts.length > 0 || allDayAlert == null) return event.alerts
  return [allDayAlert]
}

// An all-day event's alert: "On the day at 09:00", "The day before at 18:00", "2 days before at 10:00"
export function allDayAlertText(minutes: number) {
  const days = Math.max(0, Math.ceil(minutes / 1440))
  const day = days === 0 ? 'On the day' : days === 1 ? 'The day before' : `${days} days before`
  return `${day} at ${clockTime(new Date(2000, 0, 1, 0, days * 1440 - minutes).getTime())}`
}

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
export const MISSED_MS = 24 * HOUR_MS // an alert missed while SyncR was closed still shows for a day

const ALERT_PREFIX = 'event:' // starts an alert's key (DueItem.key)

// One alert of one event. dueAt: when it shows (its time, or later when snoozed)
export interface EventAlert {
  key: string // "event:<event id>@<alert time>"
  title: string
  description: string
  start: number // the event's start, shown on the card
  allDay: boolean
  at: number
  dueAt: number
  notMoved: boolean // snoozed in SyncR only: the event couldn't be moved in Google
  colorId?: string // the event's Google color
}

// Every alert of the stored events that isn't done, sorted by when they show. Which are due (and
// not older than MISSED_MS) is decided by the caller (dueReminders.ts), which keeps the time.
export async function listEventAlerts(): Promise<EventAlert[]> {
  const [events, marks, allDayAlert] = await Promise.all([db.events.toArray(), db.alertMarks.toArray(), loadAllDayAlert()])
  const byKey = new Map(marks.map((mark) => [mark.key, mark]))
  const alerts: EventAlert[] = []
  for (const event of events) {
    for (const minutes of alertsOf(event, allDayAlert)) {
      const at = event.start - minutes * 60 * 1000
      const key = `${ALERT_PREFIX}${event.id}@${at}`
      const mark = byKey.get(key)
      if (mark?.doneAt) continue
      const dueAt = mark?.snoozedUntil ?? at
      alerts.push({
        key, title: event.title, description: event.description, start: event.start, allDay: event.allDay, at, dueAt,
        notMoved: !!mark?.notMoved, colorId: event.colorId,
      })
    }
  }
  return alerts.sort((a, b) => a.dueAt - b.dueAt)
}

// "event:<id>@<time>" → the alert time, and the event's id
const alertTime = (key: string) => Number(key.slice(key.lastIndexOf('@') + 1))
export const eventId = (key: string) => key.slice(ALERT_PREFIX.length, key.lastIndexOf('@'))

// Replaces what the alert was marked with before (keeps what sync remembers about it)
async function save(key: string, change: { doneAt?: number; snoozedUntil?: number; notMoved?: boolean }) {
  const id = alertMarkId(key)
  const before = await db.alertMarks.get(id)
  await db.alertMarks.put({
    id, key, at: alertTime(key), ...change, updatedAt: Date.now(),
    syncedRev: before?.syncedRev, syncedUpdatedAt: before?.syncedUpdatedAt,
  })
  changed()
}

export const markAlertDone = (key: string) => save(key, { doneAt: Date.now() })
// When a snoozed alert shows again: in some minutes, or "Tomorrow": the alert's own time of day,
// tomorrow
function snoozeEnd(key: string, minutes: number | 'tomorrow') {
  if (minutes !== 'tomorrow') return Date.now() + minutes * 60 * 1000
  const at = new Date(alertTime(key))
  const next = new Date()
  next.setHours(at.getHours(), at.getMinutes(), 0, 0)
  next.setDate(next.getDate() + 1)
  return next.getTime()
}

// Snooze: the card goes away at once, then the event moves in Google so that its alert comes back
// at the snooze's end, on every device (event 14:30, 15-min alert shown at 14:15, 10 min → event at
// 14:40). For a repeating event only this date moves. All-day events (game releases: moving them
// would change the release day) only get the mark. If Google can't be reached, the mark stays and
// the card says so when it's back.
// The event is read again from Google first. If the other device has snoozed it already, this alert
// isn't on the event anymore and nothing moves: adding this snooze on top would delay it twice.
export async function snoozeAlert(key: string, minutes: number | 'tomorrow') {
  const until = snoozeEnd(key, minutes)
  await save(key, { snoozedUntil: until })
  const at = alertTime(key)
  const stored = await db.events.get(eventId(key))
  if (!stored || stored.allDay) return
  let event: CalendarEvent | undefined
  let start: number
  try {
    await refreshEvents()
    event = await db.events.get(stored.id)
    if (!event || !event.alerts.some((before) => event!.start - before * MINUTE_MS === at)) return
    // Google keeps whole minutes
    start = Math.round((event.start + until - at) / MINUTE_MS) * MINUTE_MS
    await updateEvent(event, { title: event.title, description: event.description, start, alert: 'keep' })
  } catch (error) {
    console.error(error)
    await save(key, { snoozedUntil: until, notMoved: true })
    return
  }
  // The moved event's alerts that come before this one (e.g. "1 day before") stay done: they
  // would come back as missed ones, or ring before the snooze ends (a moved event's alerts are
  // new alerts: new keys)
  const now = Date.now()
  for (const before of event.alerts) {
    if (start - before * MINUTE_MS < until - MINUTE_MS) await save(`${ALERT_PREFIX}${event.id}@${start - before * MINUTE_MS}`, { doneAt: now })
  }
}
