import { useEffect, useState } from 'react'
import { plural, t } from './i18n'
import { isTauri } from '@tauri-apps/api/core'
import { ArrowLeft, Bell, Check, ChevronDown, Clock } from 'lucide-react'
import { openAlertEvent, runAction, useChime, useDueReminders, type DueItem, type ReminderAction } from './dueReminders'
import { useMailAlerts, useMailCheck } from './mailAlerts'
import { useInstantMail } from './instantMail'
import { startMailbox } from './mailbox'
import { popupMonitor, useReminderPopup } from './popupWindow'
import { formatDue } from './reminders'
import { eventColor } from './calendarEvents'

// One due event alert: a strip in the event's color (none: the accent), time, title, note. A click on the text
// opens the event in SyncR (a price alert: its game). Done (big), Snooze (a key price alert: also
// Wrong key, see priceWatch.ts ignoreAlertKey), Snooze unfolds its choices in place of the
// buttons (inside the card: a menu could be cut off by the pop-up window's edge).
export function ReminderCard({ item, onAction }: { item: DueItem; onAction: (action: ReminderAction) => void }) {
  const [snoozing, setSnoozing] = useState(false)
  const color = eventColor(item.colorId)
  return (
    <div className="reminder-alert" style={color ? { borderLeftColor: color } : undefined}>
      <button className="reminder-alert-body" onClick={() => onAction('open')} title={t('Show in SyncR')}>
        <span className="reminder-alert-due">
          <Bell size={12} /> {formatDue(item.time, item.allDay)}
        </span>
        <span className="reminder-alert-text">{item.text}</span>
        {item.note && <span className="reminder-alert-note">{item.note}</span>}
        {item.notMoved && (
          <span className="reminder-alert-warning">{t("Postponed in SyncR only: Google Calendar couldn't be reached.")}</span>
        )}
      </button>
      {item.elsewhere ? (
        <div className="reminder-alert-elsewhere">
          {item.elsewhere.done ? <Check size={16} /> : <Clock size={16} />}
          {item.elsewhere.text}
        </div>
      ) : snoozing ? (
        <div className="reminder-alert-buttons">
          <button className="reminder-alert-back" onClick={() => setSnoozing(false)} title={t('Back')} aria-label={t('Back')}>
            <ArrowLeft size={15} />
          </button>
          <button onClick={() => onAction('snooze10')}>{t('10 min')}</button>
          <button onClick={() => onAction('snooze60')}>{t('1 hour')}</button>
          <button onClick={() => onAction('tomorrow')}>{t('Tomorrow')}</button>
        </div>
      ) : (
        <div className="reminder-alert-buttons">
          <button className="primary" onClick={() => onAction('done')}>
            {t('Done')}
          </button>
          <button onClick={() => setSnoozing(true)}>
            {t('Postpone')} <ChevronDown size={14} />
          </button>
          {item.keyAlert && (
            <button onClick={() => onAction('wrongkey')} title={t('Not a key I can use (e.g. Xbox): keep watching, skip keys at this price')}>
              {t('Wrong key')}
            </button>
          )}
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
  const open = due.filter((item) => !item.elsewhere)
  return (
    <>
      {open.length > 1 && (
        <div className="reminder-alerts-head">
          <span>{plural(open.length, '{n} reminder', '{n} reminders')}</span>
          <button onClick={() => open.forEach((item) => onAction(item, 'done'))}>{t('Done all')}</button>
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
  const due = useDueReminders({ runsCheck: true })
  useMailCheck() // PC: new emails go to the pop-up too
  useEffect(startMailbox, []) // PC: the Mail tab's list, ready before the tab opens
  useEffect(() => {
    if (isTauri()) popupMonitor().catch((error) => console.error(error)) // PC: notes where the pop-up's screen is
  }, [])
  useInstantMail() // PC: and within seconds, once set up (Settings → Accounts)
  const mails = useMailAlerts()
  const popupFailed = useReminderPopup(due, mails)
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
