import { useState } from 'react'
import { Mail } from 'lucide-react'
import { loadAccounts } from './gmail'
import type { MailAction, MailAlert } from './mailAlerts'
import { formatDue } from './reminders'

// New emails in the desktop pop-up, below the reminders. Same card as a reminder's: a strip in
// the account's color, when + which account, sender, subject, start of the text. A click on
// the text opens the mail in Gmail. Mark as read (big) and Keep unread (the card goes, the
// mail stays unread).
const FOLD_FROM = 4 // this many or more: one "N new emails" card until unfolded

function MailCard({ alert, onAction }: { alert: MailAlert; onAction: (action: MailAction) => void }) {
  return (
    <div className="reminder-alert" style={{ borderLeftColor: accountColor(alert.account) }}>
      <button className="reminder-alert-body" onClick={() => onAction('mail-open')} title="Open in Gmail">
        <span className="reminder-alert-due">
          <Mail size={12} /> {formatDue(alert.date)} · <span className="mail-alert-account">{alert.account}</span>
        </span>
        <span className="reminder-alert-text">{alert.from}</span>
        <span className="mail-alert-subject">{alert.subject}</span>
        {alert.snippet && <span className="reminder-alert-note">{alert.snippet}</span>}
      </button>
      <div className="reminder-alert-buttons">
        <button className="primary" onClick={() => onAction('mail-read')}>
          Mark as read
        </button>
        <button onClick={() => onAction('mail-keep')}>Keep unread</button>
      </div>
    </div>
  )
}

// The account's color (Settings → Gmail), else the accent blue
function accountColor(email: string) {
  const color = loadAccounts().find((a) => a.email === email)?.color
  return color ? `var(--text-${color})` : undefined
}

// The cards, with "N new emails · Mark all read" above them when there are 2 or more. From
// FOLD_FROM on, one card stands for all of them (senders listed) until "Show all".
export function MailCards({ alerts, onAction }: {
  alerts: MailAlert[]
  onAction: (alert: MailAlert, action: MailAction) => void
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
      <div className="reminder-alert" style={{ borderLeftColor: color }}>
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
        <MailCard key={alert.key} alert={alert} onAction={(action) => onAction(alert, action)} />
      ))}
    </>
  )
}
