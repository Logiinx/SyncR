import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { playChime } from './chime'
import { listEventAlerts, markAlertDone, MISSED_MS, snoozeAlert, snoozeAlertTomorrow } from './eventAlerts'

// What is due right now, used by the cards (ReminderAlerts.tsx) and the desktop pop-up
// (ReminderPopup.tsx): the alerts of Google Calendar events (eventAlerts.ts).

const MINUTE_MS = 60 * 1000

// One card: an event alert
export interface DueItem {
  key: string // the event alert's key ("event:…")
  text: string
  note: string
  time: number // shown on the card: the event's start
  allDay: boolean
  dueAt: number // when it came due (a snoozed one: when the snooze ended)
}

// The buttons on a due item
export type ReminderAction = 'done' | 'snooze10' | 'snooze60' | 'tomorrow' | 'open'

export function runAction(key: string, action: Exclude<ReminderAction, 'open'>) {
  if (action === 'done') return markAlertDone(key)
  if (action === 'snooze10') return snoozeAlert(key, 10)
  if (action === 'snooze60') return snoozeAlert(key, 60)
  return snoozeAlertTomorrow(key)
}

// Event alerts as cards, soonest first
async function listItems(): Promise<DueItem[]> {
  const alerts = await listEventAlerts()
  return alerts
    .map((a) => ({ key: a.key, text: a.title, note: a.description, time: a.start, allDay: a.allDay, dueAt: a.dueAt }))
    .sort((a, b) => a.dueAt - b.dueAt)
}

// Everything due and not done, kept up to date. No "already shown" bookkeeping: an alert stays
// due until Done or Snooze (per device), and alerts missed while the app was closed are simply
// due at the start, but only for a day (MISSED_MS), so a device that was off for a while
// doesn't bring back every old alert.
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

  return items?.filter((item) => item.dueAt <= now && item.dueAt > now - MISSED_MS)
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
