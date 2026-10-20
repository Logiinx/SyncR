import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type CalendarEvent } from './db'
import { calendarApi, isConnected } from './google'

// The main Google Calendar's events, shown in the Reminders tab (see DECISIONS.md, "Reminders
// become Google Calendar events"). Loaded from Google and kept on this device (db.events), so
// the tab also works offline. Covers the Reminders month grid: this month and the next 11.

const MONTHS_AHEAD = 11 // like the grid's MAX_MONTHS (RemindersView.tsx): 12 months in all
const REFRESH_MS = 5 * 60 * 1000 // while the Reminders tab is open

// Google's event, the parts we use
interface GoogleEvent {
  id: string
  status: string
  summary?: string
  description?: string
  start: { date?: string; dateTime?: string }
  end: { date?: string; dateTime?: string }
  recurringEventId?: string
  reminders?: { useDefault: boolean; overrides?: { method: string; minutes: number }[] }
  colorId?: string
  htmlLink: string
}

interface Reminder {
  method: string
  minutes: number
}

// "2026-10-20" (all-day events) is local midnight; a dateTime has its own time zone
function toTime(when: { date?: string; dateTime?: string }) {
  if (when.dateTime) return Date.parse(when.dateTime)
  const [year, month, day] = when.date!.split('-').map(Number)
  return new Date(year, month - 1, day).getTime()
}

// Descriptions may contain HTML (Google Calendar's editor adds links and line breaks)
function plainText(html: string) {
  const doc = new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, '\n'), 'text/html')
  return (doc.body.textContent ?? '').trim()
}

// Only pop-up notifications count (not emails)
const popups = (reminders: Reminder[]) => reminders.filter((r) => r.method === 'popup').map((r) => r.minutes)

function toEvent(event: GoogleEvent, defaults: Reminder[]): CalendarEvent {
  return {
    id: event.id,
    title: event.summary ?? '(No title)',
    description: event.description ? plainText(event.description) : '',
    start: toTime(event.start),
    end: toTime(event.end),
    allDay: !event.start.dateTime,
    seriesId: event.recurringEventId,
    alerts: event.reminders?.useDefault === false ? popups(event.reminders.overrides ?? []) : popups(defaults),
    colorId: event.colorId,
    link: event.htmlLink,
  }
}

let running: Promise<void> | null = null

// Loads the events again and replaces the stored ones. One at a time: a second call while one
// runs waits for that one. Throws when offline or Google fails (the stored events stay).
export function refreshEvents(): Promise<void> {
  running ??= load().finally(() => (running = null))
  return running
}

async function load() {
  if (!isConnected()) return
  const now = new Date()
  const params = new URLSearchParams({
    singleEvents: 'true', // a repeating event as one event per date
    orderBy: 'startTime',
    timeMin: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
    timeMax: new Date(now.getFullYear(), now.getMonth() + MONTHS_AHEAD + 1, 1).toISOString(),
    maxResults: '2500',
  })
  const events: CalendarEvent[] = []
  for (let pageToken = ''; ; ) {
    if (pageToken) params.set('pageToken', pageToken)
    const page = await calendarApi(`calendars/primary/events?${params}`)
    const defaults: Reminder[] = page.defaultReminders ?? []
    for (const event of page.items as GoogleEvent[]) {
      if (event.status !== 'cancelled') events.push(toEvent(event, defaults))
    }
    if (!page.nextPageToken) break
    pageToken = page.nextPageToken
  }
  if (!isConnected()) return // disconnected meanwhile: don't bring the events back
  await db.transaction('rw', db.events, async () => {
    await db.events.clear()
    await db.events.bulkPut(events)
  })
}

// ---------- Add, edit, delete (need internet; each reloads the events after) ----------

export type Repeat = 'none' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'

// What the event window (EventDialog.tsx) edits. alert: minutes before the start for the
// notification, null = none, 'keep' = leave the event's alerts as they are (it has several)
export interface EventFields {
  title: string
  description: string
  start: number
  alert: number | null | 'keep'
}

const NEW_EVENT_MS = 15 * 60 * 1000 // the end isn't shown in SyncR; new events last 15 minutes

// Google wants local time ("2026-10-21T10:00:00") with the time zone next to it (needed for
// repeating events, so their time stays the same across daylight saving changes)
function googleTime(time: number) {
  const date = new Date(time)
  const pad = (n: number) => String(n).padStart(2, '0')
  const dateTime = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`
  return { dateTime, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
}

// An all-day event's day: "2026-10-21"
function googleDay(time: number) {
  const date = new Date(time)
  const pad = (n: number) => String(n).padStart(2, '0')
  return { date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` }
}

const googleAlerts = (alert: number | null) =>
  alert === null ? { useDefault: false, overrides: [] } : { useDefault: false, overrides: [{ method: 'popup', minutes: alert }] }

export async function createEvent(fields: EventFields, repeat: Repeat) {
  await calendarApi('calendars/primary/events', {
    method: 'POST',
    body: JSON.stringify({
      summary: fields.title,
      description: fields.description,
      start: googleTime(fields.start),
      end: googleTime(fields.start + NEW_EVENT_MS),
      ...(fields.alert !== 'keep' && { reminders: googleAlerts(fields.alert) }),
      ...(repeat !== 'none' && { recurrence: [`RRULE:FREQ=${repeat}`] }),
    }),
  })
  await refreshEvents()
}

// Sends only what changed, so what SyncR doesn't show (color, place, guests…) stays. For one
// date of a repeating event, only that date changes (Google keeps it as an exception).
export async function updateEvent(event: CalendarEvent, fields: EventFields) {
  const changes: Record<string, unknown> = {}
  if (fields.title !== event.title) changes.summary = fields.title
  if (fields.description !== event.description) changes.description = fields.description
  if (fields.start !== event.start) {
    // Keeps the event's length; an all-day event stays all-day (on its new day)
    const end = fields.start + (event.end - event.start)
    Object.assign(
      changes,
      event.allDay
        ? { start: googleDay(fields.start), end: googleDay(end) }
        : { start: googleTime(fields.start), end: googleTime(end) },
    )
  }
  if (fields.alert !== 'keep') changes.reminders = googleAlerts(fields.alert)
  if (Object.keys(changes).length === 0) return
  await calendarApi(`calendars/primary/events/${encodeURIComponent(event.id)}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  })
  await refreshEvents()
}

// For one date of a repeating event: only that date goes
export async function deleteEvent(event: CalendarEvent) {
  await calendarApi(`calendars/primary/events/${encodeURIComponent(event.id)}`, { method: 'DELETE' })
  await refreshEvents()
}

// For the Reminders tab: the stored events (soonest first), refreshed when the tab opens, every
// 5 minutes while it's open, and when the app comes back to the front. error: the last refresh
// failed (the stored events still show).
export function useCalendarEvents() {
  const events = useLiveQuery(async () => (await db.events.toArray()).sort((a, b) => a.start - b.start), [])
  const [connected, setConnected] = useState(isConnected)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onChange = () => setConnected(isConnected())
    window.addEventListener('google-change', onChange)
    return () => window.removeEventListener('google-change', onChange)
  }, [])

  useEffect(() => {
    if (!connected) return
    const refresh = () =>
      refreshEvents()
        .then(() => setError(null))
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
    const onVisible = () => document.visibilityState === 'visible' && refresh()
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [connected])

  return { events, connected, error }
}
