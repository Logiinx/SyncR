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
