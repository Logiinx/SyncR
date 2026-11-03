import { useLiveQuery } from 'dexie-react-hooks'
import { updateEvent } from './calendarEvents'
import { changed, db, type CalendarEvent } from './db'
import { clockTime } from './dates'

// The alerts of the Google Calendar events (calendarEvents.ts): each event's alert times
// (its own, or the calendar's default: CalendarEvent.alerts; all-day events: see alertsOf) come
// due and show in the pop-up / cards (dueReminders.ts). Done only changes this device
// (db.alertStates, not synced); Snooze also moves the event in Google (snoozeAlert).

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
const KEEP_STATES_MS = 7 * 24 * HOUR_MS

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
  notMoved: boolean // snoozed on this device only: the event couldn't be moved in Google
  colorId?: string // the event's Google color
}

// Every alert of the stored events that isn't done, sorted by when they show. Which are due (and
// not older than MISSED_MS) is decided by the caller (dueReminders.ts), which keeps the time.
export async function listEventAlerts(): Promise<EventAlert[]> {
  const [events, states, allDayAlert] = await Promise.all([db.events.toArray(), db.alertStates.toArray(), loadAllDayAlert()])
  const byKey = new Map(states.map((state) => [state.key, state]))
  const alerts: EventAlert[] = []
  for (const event of events) {
    for (const minutes of alertsOf(event, allDayAlert)) {
      const at = event.start - minutes * 60 * 1000
      const key = `${ALERT_PREFIX}${event.id}@${at}`
      const state = byKey.get(key)
      if (state?.doneAt) continue
      const dueAt = state?.snoozedUntil ?? at
      alerts.push({
        key, title: event.title, description: event.description, start: event.start, allDay: event.allDay, at, dueAt,
        notMoved: !!state?.notMoved, colorId: event.colorId,
      })
    }
  }
  return alerts.sort((a, b) => a.dueAt - b.dueAt)
}

// "event:<id>@<time>" → the alert time, and the event's id
const alertTime = (key: string) => Number(key.slice(key.lastIndexOf('@') + 1))
export const eventId = (key: string) => key.slice(ALERT_PREFIX.length, key.lastIndexOf('@'))

async function save(key: string, change: { doneAt?: number; snoozedUntil?: number; notMoved?: boolean }) {
  await db.alertStates.put({ key, at: alertTime(key), ...change })
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

// Snooze: the card goes away at once (this device), then the event moves in Google so that its
// alert comes back at the snooze's end, on every device (event 14:30, 15-min alert shown at 14:15,
// 10 min → event at 14:40). For a repeating event only this date moves. All-day events (game
// releases: moving them would change the release day) are only snoozed here. If Google can't be
// reached, the snooze stays on this device and the card says so when it's back.
export async function snoozeAlert(key: string, minutes: number | 'tomorrow') {
  const until = snoozeEnd(key, minutes)
  await save(key, { snoozedUntil: until })
  const event = await db.events.get(eventId(key))
  if (!event || event.allDay) return
  // Google keeps whole minutes
  const start = Math.round((event.start + until - alertTime(key)) / MINUTE_MS) * MINUTE_MS
  try {
    await updateEvent(event, { title: event.title, description: event.description, start, alert: 'keep' })
  } catch (error) {
    console.error(error)
    await save(key, { snoozedUntil: until, notMoved: true })
    return
  }
  // The moved event's other alerts that are now past (e.g. "1 day before") stay done, instead of
  // coming back as missed ones (a moved event's alerts are new alerts: new keys)
  const now = Date.now()
  for (const before of event.alerts) {
    const at = start - before * MINUTE_MS
    if (at < now) await save(`${ALERT_PREFIX}${event.id}@${at}`, { doneAt: now })
  }
}

// States of alerts more than a week old aren't needed anymore (those alerts no longer show)
export async function removeOldAlertStates() {
  const old = Date.now() - KEEP_STATES_MS
  await db.alertStates.filter((state) => state.at < old && (state.snoozedUntil ?? 0) < old).delete()
}
