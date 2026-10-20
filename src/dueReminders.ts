import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { playChime } from './chime'
import {
  ALERT_PREFIX,
  listEventAlerts,
  markAlertDone,
  MISSED_MS,
  snoozeAlert,
  snoozeAlertTomorrow,
} from './eventAlerts'
import { listReminders, markDone, snooze, snoozeTomorrow } from './reminders'

// What is due right now, used by the cards (ReminderAlerts.tsx) and the desktop pop-up
// (ReminderPopup.tsx): SyncR's own reminders and the alerts of Google Calendar events
// (eventAlerts.ts), shown the same way.

const MINUTE_MS = 60 * 1000

// One card: a reminder or an event alert
export interface DueItem {
  key: string // a reminder's id, or an event alert's key ("event:…")
  text: string
  note: string
  time: number // shown on the card: the reminder's time, or the event's start
  allDay: boolean
  dueAt: number // when it came due (a snoozed one: when the snooze ended)
}

// The buttons on a due item
export type ReminderAction = 'done' | 'snooze10' | 'snooze60' | 'tomorrow' | 'open'

export function runAction(key: string, action: Exclude<ReminderAction, 'open'>) {
  if (key.startsWith(ALERT_PREFIX)) {
    if (action === 'done') return markAlertDone(key)
    if (action === 'snooze10') return snoozeAlert(key, 10)
    if (action === 'snooze60') return snoozeAlert(key, 60)
    return snoozeAlertTomorrow(key)
  }
  if (action === 'done') return markDone(key)
  if (action === 'snooze10') return snooze(key, 10)
  if (action === 'snooze60') return snooze(key, 60)
  return snoozeTomorrow(key)
}

// Waiting reminders and event alerts as cards, soonest first
async function listItems(): Promise<DueItem[]> {
  const [reminders, alerts] = await Promise.all([listReminders(), listEventAlerts()])
  return [
    ...reminders
      .filter((r) => r.doneAt === null)
      .map((r) => ({ key: r.id, text: r.text, note: r.note, time: r.dueAt, allDay: false, dueAt: r.dueAt })),
    ...alerts.map((a) => ({ key: a.key, text: a.title, note: a.description, time: a.start, allDay: a.allDay, dueAt: a.dueAt })),
  ].sort((a, b) => a.dueAt - b.dueAt)
}

// Everything due and not done, kept up to date. No "already shown" bookkeeping: a reminder
// stays due until Done or Snooze (on any device, since the status syncs), and reminders missed
// while the app was closed are simply due at the start. Event alerts: the same, but Done and
// Snooze are per device, and a missed one only shows for a day (MISSED_MS), so a device
// that was off for a while doesn't bring back every old alert.
// undefined = still loading.
export function useDueReminders(): DueItem[] | undefined {
  const items = useLiveQuery(listItems, [])
  const [now, setNow] = useState(Date.now())

  // Wake up exactly when the next one is due (and at least every minute, in case the
  // clock or the sleep of the computer shifts things), and when the app comes back into view
  const nextDue = items?.find((item) => item.dueAt > now)?.dueAt
  useEffect(() => {
    const wait = nextDue ? Math.min(nextDue - Date.now(), MINUTE_MS) : MINUTE_MS
    const timer = setTimeout(() => setNow(Date.now()), Math.max(wait, 0) + 50)
    const onVisible = () => document.visibilityState === 'visible' && setNow(Date.now())
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [nextDue, now])

  return items?.filter(
    (item) => item.dueAt <= now && (!item.key.startsWith(ALERT_PREFIX) || item.dueAt > now - MISSED_MS),
  )
}

// Chimes once for each item that newly comes due (a snoozed one counts as new again)
export function useChime(due: DueItem[] | undefined) {
  const chimed = useRef(new Set<string>())
  useEffect(() => {
    if (!due) return
    const keys = due.map((item) => `${item.key}@${item.dueAt}`)
    if (keys.some((key) => !chimed.current.has(key))) playChime()
    chimed.current = new Set(keys)
  }, [due])
}
