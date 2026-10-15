import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { playChime } from './chime'
import type { Reminder } from './db'
import { listReminders, markDone, snooze, snoozeTomorrow } from './reminders'

// Which reminders are due right now, used by the cards (ReminderAlerts.tsx) and the
// desktop pop-up (ReminderPopup.tsx).

const MINUTE_MS = 60 * 1000

// The buttons on a due reminder
export type ReminderAction = 'done' | 'snooze10' | 'snooze60' | 'tomorrow' | 'open'

export function runAction(id: string, action: Exclude<ReminderAction, 'open'>) {
  if (action === 'done') return markDone(id)
  if (action === 'snooze10') return snooze(id, 10)
  if (action === 'snooze60') return snooze(id, 60)
  return snoozeTomorrow(id)
}

// Every reminder that is due and not done, kept up to date. No "already shown" bookkeeping:
// a reminder stays due until Done or Snooze (on any device, since the status syncs), and
// reminders missed while the app was closed are simply due at the start.
// undefined = still loading.
export function useDueReminders(): Reminder[] | undefined {
  const reminders = useLiveQuery(listReminders, [])
  const [now, setNow] = useState(Date.now())

  // Wake up exactly when the next reminder is due (and at least every minute, in case the
  // clock or the sleep of the computer shifts things), and when the app comes back into view
  const nextDue = reminders?.find((r) => r.doneAt === null && r.dueAt > now)?.dueAt
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

  return reminders?.filter((r) => r.doneAt === null && r.dueAt <= now)
}

// Chimes once for each reminder that newly comes due (a snoozed one counts as new again)
export function useChime(due: Reminder[] | undefined) {
  const chimed = useRef(new Set<string>())
  useEffect(() => {
    if (!due) return
    const keys = due.map((r) => `${r.id}@${r.dueAt}`)
    if (keys.some((key) => !chimed.current.has(key))) playChime()
    chimed.current = new Set(keys)
  }, [due])
}
