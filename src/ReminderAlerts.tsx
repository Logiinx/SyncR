import { isTauri } from '@tauri-apps/api/core'
import { Bell } from 'lucide-react'
import type { Reminder } from './db'
import { runAction, useChime, useDueReminders, type ReminderAction } from './dueReminders'
import { useReminderPopup } from './popupWindow'
import { formatDue } from './reminders'

// One due reminder: text, time, note, and the buttons. "Open SyncR" only in the pop-up.
export function ReminderCard({ reminder, onAction, withOpen }: {
  reminder: Reminder
  onAction: (action: ReminderAction) => void
  withOpen?: boolean
}) {
  return (
    <div className="reminder-alert">
      <div className="reminder-alert-head">
        <Bell size={14} />
        <span className="reminder-alert-text">{reminder.text}</span>
      </div>
      <div className="reminder-alert-due">{formatDue(reminder.dueAt)}</div>
      {reminder.note && <div className="reminder-alert-note">{reminder.note}</div>}
      <div className="reminder-alert-buttons">
        <button className="primary" onClick={() => onAction('done')}>
          Done
        </button>
        <span className="reminder-alert-label">Snooze:</span>
        <button onClick={() => onAction('snooze10')}>10 min</button>
        <button onClick={() => onAction('snooze60')}>1 hour</button>
        <button onClick={() => onAction('tomorrow')}>Tomorrow</button>
      </div>
      {withOpen && (
        <button className="reminder-alert-open" onClick={() => onAction('open')}>
          Open SyncR
        </button>
      )}
    </div>
  )
}

// Due reminders in the main window. On the PC they go to the pop-up window instead
// (popupWindow.ts), which shows even while SyncR is hidden; the cards here are the
// fallback if the pop-up can't open. In the browser / on the phone: cards, bottom-right.
function ReminderAlerts() {
  const due = useDueReminders()
  const popupFailed = useReminderPopup(due)
  const showCards = !isTauri() || popupFailed
  useChime(showCards ? due : undefined)

  if (!showCards || !due?.length) return null
  return (
    <div className="reminder-alerts" role="alert">
      {due.map((reminder) => (
        <ReminderCard
          key={reminder.id}
          reminder={reminder}
          onAction={(action) => action !== 'open' && runAction(reminder.id, action)}
        />
      ))}
    </div>
  )
}

export default ReminderAlerts
