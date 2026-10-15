import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Bell } from 'lucide-react'
import { formatDue, listReminders, markDone, snooze, snoozeTomorrow } from './reminders'

const MINUTE_MS = 60 * 1000

// Cards in the bottom-right corner for every reminder that is due and not done.
// No "already shown" bookkeeping: a card stays until Done or Snooze (on any device, since the
// status syncs), and reminders missed while the app was closed simply show up at the start.
function ReminderAlerts() {
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

  const due = reminders?.filter((r) => r.doneAt === null && r.dueAt <= now) ?? []
  if (due.length === 0) return null

  return (
    <div className="reminder-alerts" role="alert">
      {due.map((reminder) => (
        <div key={reminder.id} className="reminder-alert">
          <div className="reminder-alert-head">
            <Bell size={14} />
            <span className="reminder-alert-text">{reminder.text}</span>
          </div>
          <div className="reminder-alert-due">{formatDue(reminder.dueAt)}</div>
          {reminder.note && <div className="reminder-alert-note">{reminder.note}</div>}
          <div className="reminder-alert-buttons">
            <button className="primary" onClick={() => markDone(reminder.id)}>
              Done
            </button>
            <span className="reminder-alert-label">Snooze:</span>
            <button onClick={() => snooze(reminder.id, 10)}>10 min</button>
            <button onClick={() => snooze(reminder.id, 60)}>1 hour</button>
            <button onClick={() => snoozeTomorrow(reminder.id)}>Tomorrow</button>
          </div>
        </div>
      ))}
    </div>
  )
}

export default ReminderAlerts
