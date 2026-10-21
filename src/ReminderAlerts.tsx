import { useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { ArrowLeft, Bell, ChevronDown } from 'lucide-react'
import { openAlertEvent, runAction, useChime, useDueReminders, type DueItem, type ReminderAction } from './dueReminders'
import { useReminderPopup } from './popupWindow'
import { formatDue } from './reminders'

// Google Calendar's event colors (colorId "1" to "11"), for the card's strip. None: the accent.
const EVENT_COLORS: Record<string, string> = {
  1: '#7986cb', 2: '#33b679', 3: '#8e24aa', 4: '#e67c73', 5: '#f6bf26', 6: '#f4511e',
  7: '#039be5', 8: '#616161', 9: '#3f51b5', 10: '#0b8043', 11: '#d50000',
}

// One due event alert: a strip in the event's color, time, title, note. A click on the text
// opens the event in SyncR. Done (big), and Snooze, which unfolds its choices in place of the
// buttons (inside the card: a menu could be cut off by the pop-up window's edge).
export function ReminderCard({ item, onAction }: { item: DueItem; onAction: (action: ReminderAction) => void }) {
  const [snoozing, setSnoozing] = useState(false)
  const color = item.colorId && EVENT_COLORS[item.colorId]
  return (
    <div className="reminder-alert" style={color ? { borderLeftColor: color } : undefined}>
      <button className="reminder-alert-body" onClick={() => onAction('open')} title="Show in SyncR">
        <span className="reminder-alert-due">
          <Bell size={12} /> {formatDue(item.time, item.allDay)}
        </span>
        <span className="reminder-alert-text">{item.text}</span>
        {item.note && <span className="reminder-alert-note">{item.note}</span>}
        {item.notMoved && (
          <span className="reminder-alert-warning">Snoozed on this device only: Google Calendar couldn't be reached.</span>
        )}
      </button>
      {snoozing ? (
        <div className="reminder-alert-buttons">
          <button className="reminder-alert-back" onClick={() => setSnoozing(false)} title="Back" aria-label="Back">
            <ArrowLeft size={15} />
          </button>
          <button onClick={() => onAction('snooze10')}>10 min</button>
          <button onClick={() => onAction('snooze60')}>1 hour</button>
          <button onClick={() => onAction('tomorrow')}>Tomorrow</button>
        </div>
      ) : (
        <div className="reminder-alert-buttons">
          <button className="primary" onClick={() => onAction('done')}>
            Done
          </button>
          <button onClick={() => setSnoozing(true)}>
            Snooze <ChevronDown size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

// The cards, with "Done all" above them when there are 2 or more
export function ReminderCards({ due, onAction }: {
  due: DueItem[]
  onAction: (item: DueItem, action: ReminderAction) => void
}) {
  return (
    <>
      {due.length > 1 && (
        <div className="reminder-alerts-head">
          <span>{due.length} reminders</span>
          <button onClick={() => due.forEach((item) => onAction(item, 'done'))}>Done all</button>
        </div>
      )}
      {due.map((item) => (
        <ReminderCard key={item.key} item={item} onAction={(action) => onAction(item, action)} />
      ))}
    </>
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
      <ReminderCards
        due={due}
        onAction={(item, action) => (action === 'open' ? openAlertEvent(item.key) : runAction(item.key, action))}
      />
    </div>
  )
}

export default ReminderAlerts
