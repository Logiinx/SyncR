import { db } from './db'

// The alerts of the Google Calendar events (calendarEvents.ts): each event's alert times
// (its own, or the calendar's default: CalendarEvent.alerts) come due like reminders and show
// in the same pop-up / cards (dueReminders.ts). Done and Snooze only change this device
// (db.alertStates, not synced), never the event in Google.

const HOUR_MS = 60 * 60 * 1000
export const MISSED_MS = 24 * HOUR_MS // an alert missed while SyncR was closed still shows for a day
const KEEP_STATES_MS = 7 * 24 * HOUR_MS

export const ALERT_PREFIX = 'event:' // tells an event alert's key apart from a reminder's id

// One alert of one event. dueAt: when it shows (its time, or later when snoozed)
export interface EventAlert {
  key: string // "event:<event id>@<alert time>"
  title: string
  description: string
  start: number // the event's start, shown on the card
  allDay: boolean
  at: number
  dueAt: number
}

// Every alert of the stored events that isn't done, sorted by when they show. Which are due (and
// not older than MISSED_MS) is decided by the caller (dueReminders.ts), which keeps the time.
export async function listEventAlerts(): Promise<EventAlert[]> {
  const [events, states] = await Promise.all([db.events.toArray(), db.alertStates.toArray()])
  const byKey = new Map(states.map((state) => [state.key, state]))
  const alerts: EventAlert[] = []
  for (const event of events) {
    for (const minutes of event.alerts) {
      const at = event.start - minutes * 60 * 1000
      const key = `${ALERT_PREFIX}${event.id}@${at}`
      const state = byKey.get(key)
      if (state?.doneAt) continue
      const dueAt = state?.snoozedUntil ?? at
      alerts.push({ key, title: event.title, description: event.description, start: event.start, allDay: event.allDay, at, dueAt })
    }
  }
  return alerts.sort((a, b) => a.dueAt - b.dueAt)
}

// "event:<id>@<time>" → the alert time
const alertTime = (key: string) => Number(key.slice(key.lastIndexOf('@') + 1))

async function save(key: string, change: { doneAt?: number; snoozedUntil?: number }) {
  await db.alertStates.put({ key, at: alertTime(key), ...change })
}

export const markAlertDone = (key: string) => save(key, { doneAt: Date.now() })
export const snoozeAlert = (key: string, minutes: number) => save(key, { snoozedUntil: Date.now() + minutes * 60 * 1000 })

// "Tomorrow": the alert's own time of day, tomorrow (like snoozeTomorrow in reminders.ts)
export function snoozeAlertTomorrow(key: string) {
  const at = new Date(alertTime(key))
  const next = new Date()
  next.setHours(at.getHours(), at.getMinutes(), 0, 0)
  next.setDate(next.getDate() + 1)
  return save(key, { snoozedUntil: next.getTime() })
}

// States of alerts more than a week old aren't needed anymore (those alerts no longer show)
export async function removeOldAlertStates() {
  const old = Date.now() - KEEP_STATES_MS
  await db.alertStates.filter((state) => state.at < old && (state.snoozedUntil ?? 0) < old).delete()
}
