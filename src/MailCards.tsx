import { useState, type ReactNode } from 'react'
import { Mail, Trash2 } from 'lucide-react'
import { loadAccounts } from './gmail'
import type { MailAction, MailAlert } from './mailAlerts'
import { formatDue } from './reminders'
import Spinner from './Spinner'

// New emails in the desktop pop-up, below the reminders. Same card as a reminder's: a strip in
// the account's color, when + which account, sender, subject, start of the text. A click on
// the text opens the mail to read in the pop-up (MailReader.tsx). Mark as read (big) and Keep
// unread (the card goes, the mail stays unread). A spinner after the account while a clicked
// mail is still loading.
const FOLD_FROM = 4 // this many or more: one "N new emails" card until unfolded

function MailCard({ alert, fading, loading, onAction, onRead }: {
  alert: MailAlert
  fading: boolean // fading out by itself (ReminderPopup.tsx)
  loading: boolean
  onAction: (action: MailAction) => void
  onRead: () => void
}) {
  return (
    <div className={`reminder-alert${fading ? ' fading' : ''}`} style={{ borderLeftColor: accountColor(alert.account) }}>
      <button className="reminder-alert-body" onClick={onRead} title="Read">
        <MailWhen alert={alert}>{loading && <Spinner size={12} />}</MailWhen>
        <span className="reminder-alert-text">{alert.from}</span>
        <span className="mail-alert-subject">{alert.subject}</span>
        {alert.snippet && <span className="reminder-alert-note">{alert.snippet}</span>}
      </button>
      <MailButtons opened={alert.opened} onAction={onAction} />
    </div>
  )
}

// A mail's top line, on its card and in the reader: when it came + which account
export function MailWhen({ alert, children }: { alert: MailAlert; children?: ReactNode }) {
  return (
    <span className="reminder-alert-due">
      <Mail size={12} /> {formatDue(alert.date)} · <span className="mail-alert-account" title={alert.account}>{alert.account}</span>
      {children}
    </span>
  )
}

// A new mail: Mark as read (big) · Keep unread. One already opened (so read): Done · Mark as
// unread. Then a red trash at the right: Delete (to Gmail's Trash, no question, like the Mail
// tab's menu). Also under the mail in the reader.
export function MailButtons({ opened, onAction }: { opened?: boolean; onAction: (action: MailAction) => void }) {
  return (
    <div className="reminder-alert-buttons">
      <button className="primary" onClick={() => onAction(opened ? 'mail-close' : 'mail-read')}>
        {opened ? 'Done' : 'Mark as read'}
      </button>
      <button onClick={() => onAction(opened ? 'mail-unread' : 'mail-close')}>
        {opened ? 'Mark as unread' : 'Keep unread'}
      </button>
      <button className="mail-delete" onClick={() => onAction('mail-delete')} title="Delete" aria-label="Delete">
        <Trash2 size={15} />
      </button>
    </div>
  )
}

// The account's color (Settings → Gmail), else the accent blue
export function accountColor(email: string) {
  const color = loadAccounts().find((a) => a.email === email)?.color
  return color ? `var(--text-${color})` : undefined
}

// The cards, with "N new emails · Mark all read" above them when there are 2 or more. From
// FOLD_FROM on, one card stands for all of them (senders listed) until "Show all".
export function MailCards({ alerts, fading, loadingKey = null, onAction, onRead }: {
  alerts: MailAlert[]
  fading: Set<string> // keys of cards fading out by themselves
  loadingKey?: string | null // the card whose mail is loading to be read
  onAction: (alert: MailAlert, action: MailAction) => void
  onRead: (alert: MailAlert) => void
}) {
  const [unfolded, setUnfolded] = useState(false)
  if (alerts.length === 0) return null
  const all = (action: MailAction) => alerts.forEach((alert) => onAction(alert, action))
  if (alerts.length >= FOLD_FROM && !unfolded) {
    const senders = [...new Set(alerts.map((a) => a.from))]
    const accounts = new Set(alerts.map((a) => a.account))
    // The account's color when they're all from one account, else the accent blue
    const color = accounts.size === 1 ? accountColor(alerts[0].account) : undefined
    return (
      <div
        className={`reminder-alert${alerts.every((a) => fading.has(a.key)) ? ' fading' : ''}`}
        style={{ borderLeftColor: color }}
      >
        <button className="reminder-alert-body" onClick={() => setUnfolded(true)} title="Show all">
          <span className="reminder-alert-due">
            <Mail size={12} /> {formatDue(alerts[0].date)}
          </span>
          <span className="reminder-alert-text">{alerts.length} new emails</span>
          <span className="reminder-alert-note">{senders.join(', ')}</span>
        </button>
        <div className="reminder-alert-buttons">
          <button className="primary" onClick={() => all('mail-read')}>
            Mark all read
          </button>
          <button onClick={() => setUnfolded(true)}>Show all</button>
        </div>
      </div>
    )
  }
  return (
    <>
      {alerts.length > 1 && (
        <div className="reminder-alerts-head">
          <span>{alerts.length} new emails</span>
          <button onClick={() => all('mail-read')}>Mark all read</button>
        </div>
      )}
      {alerts.map((alert) => (
        <MailCard
          key={alert.key}
          alert={alert}
          fading={fading.has(alert.key)}
          loading={alert.key === loadingKey}
          onAction={(action) => onAction(alert, action)}
          onRead={() => onRead(alert)}
        />
      ))}
    </>
  )
}
