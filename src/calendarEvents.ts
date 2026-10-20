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
  recurrence?: string[] // a series: its repeat rule, e.g. ["RRULE:FREQ=WEEKLY"]
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

// ---------- All events of a repeating event (the series) ----------

// 'custom': a rule SyncR can't show as one of its choices (kept as it is)
export type SeriesRepeat = Exclude<Repeat, 'none'> | 'custom'

const DAY_MS = 24 * 60 * 60 * 1000

// A series' repeat rule as one of the simple choices. Google Calendar writes e.g.
// "RRULE:FREQ=MONTHLY;WKST=MO;INTERVAL=1;BYMONTHDAY=3": its extra parts only repeat what the
// start date says, so that's "Every month". Anything more (every 2 weeks, an end date, several
// days, "first Monday") is 'custom'.
function seriesRepeat(recurrence: string[] = []): SeriesRepeat {
  const rules = recurrence.filter((line) => line.startsWith('RRULE:'))
  if (rules.length !== 1) return 'custom'
  const parts = rules[0].slice('RRULE:'.length).split(';').map((part) => part.split('='))
  const freq = parts.find(([key]) => key === 'FREQ')?.[1]
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return 'custom'
  const plain = parts.every(
    ([key, value]) =>
      key === 'FREQ' ||
      key === 'WKST' ||
      (key === 'INTERVAL' && value === '1') ||
      (key === 'BYDAY' && /^[A-Z]{2}$/.test(value)) || // one weekday, without "1" (first) etc.
      ((key === 'BYMONTHDAY' || key === 'BYMONTH') && /^\d+$/.test(value)),
  )
  return plain ? freq : 'custom'
}

const series = (event: CalendarEvent): Promise<GoogleEvent> =>
  calendarApi(`calendars/primary/events/${encodeURIComponent(event.seriesId!)}`)

// For the event window: how the series repeats (needs internet)
export async function loadSeriesRepeat(event: CalendarEvent) {
  return seriesRepeat((await series(event)).recurrence)
}

// Changes all events of the series. What changed is found by comparing with this one date
// (event), then applied to the series. A new time applies to all dates; a new date moves the
// whole series by the same number of days (e.g. every 3rd → every 5th of the month).
export async function updateSeries(event: CalendarEvent, fields: EventFields, repeat: SeriesRepeat) {
  const master = await series(event)
  const current = seriesRepeat(master.recurrence)
  const changes: Record<string, unknown> = {}
  if (fields.title !== event.title) changes.summary = fields.title
  if (fields.description !== event.description) changes.description = fields.description
  const days = Math.round((new Date(fields.start).setHours(0, 0, 0, 0) - new Date(event.start).setHours(0, 0, 0, 0)) / DAY_MS)
  if (fields.start !== event.start) {
    // A rule with fixed days (every 3rd) would stay on them: refuse instead of mixing things up
    if (days !== 0 && current === 'custom') {
      throw new Error("This event repeats in a way SyncR can't change: move its dates in Google Calendar.")
    }
    const start = new Date(toTime(master.start))
    const length = toTime(master.end) - start.getTime()
    start.setDate(start.getDate() + days) // the clock time stays, also across daylight saving changes
    if (event.allDay) {
      const end = new Date(start)
      end.setDate(end.getDate() + Math.round(length / DAY_MS))
      Object.assign(changes, { start: googleDay(start.getTime()), end: googleDay(end.getTime()) })
    } else {
      const time = new Date(fields.start)
      start.setHours(time.getHours(), time.getMinutes(), 0, 0)
      Object.assign(changes, { start: googleTime(start.getTime()), end: googleTime(start.getTime() + length) })
    }
  }
  if (fields.alert !== 'keep') changes.reminders = googleAlerts(fields.alert)
  // A new choice, or a new day for a simple rule ("on the 3rd" must become "on the 5th"):
  // write the rule again. Other lines (dates deleted on their own) stay.
  if (repeat !== 'custom' && (repeat !== current || days !== 0)) {
    const others = (master.recurrence ?? []).filter((line) => !line.startsWith('RRULE:'))
    changes.recurrence = [...others, `RRULE:FREQ=${repeat}`]
  }
  if (Object.keys(changes).length === 0) return
  await calendarApi(`calendars/primary/events/${encodeURIComponent(event.seriesId!)}`, {
    method: 'PATCH',
    body: JSON.stringify(changes),
  })
  await refreshEvents()
}

export async function deleteSeries(event: CalendarEvent) {
  await calendarApi(`calendars/primary/events/${encodeURIComponent(event.seriesId!)}`, { method: 'DELETE' })
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
