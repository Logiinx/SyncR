import { type CSSProperties, type ReactNode } from 'react'
import { plural, t } from './i18n'
import { Check, Mail, Trash2 } from 'lucide-react'
import { loadAccounts } from './gmail'
import type { MailAction, MailAlert } from './mailAlerts'
import { DragRow, type DragAction } from './MailDrag'
import { clockTime, dayTime } from './dates'
import { formatDue } from './reminders'
import Spinner from './Spinner'

// New emails in the desktop pop-up, below the reminders (mockup H, mail-popup-cards.html): a
// strip in the account's color, the sender's first letter in a circle of that color, sender +
// when, the account (dot + address), the subject (bold until opened), 2 lines of the text. A
// click on the text opens the mail to read in the pop-up (MailReader.tsx). A flat bar of
// buttons at the bottom (MailBar). A spinner before the time while a clicked mail is still
// loading. Dragged left or right: the actions chosen in Settings → Alerts (MailDrag.tsx); each
// one takes the card away, like its buttons. Only the newest email gets a card; the older ones
// are one-line rows below it (MailRow).

// What a drag does to an email in the pop-up (card or row)
const dragAction = (alert: MailAlert, action: DragAction): MailAction =>
  action === 'archive' ? 'mail-archive' : action === 'trash' ? 'mail-delete' : alert.opened ? 'mail-unread' : 'mail-read'

function MailCard({ alert, fading, loading, single, onAction, onRead }: {
  alert: MailAlert
  fading: boolean // fading out by itself (ReminderPopup.tsx)
  single: boolean // the only email: up to 4 lines of its text instead of 2 (mockup G)
  loading: boolean
  onAction: (action: MailAction) => void
  onRead: () => void
}) {
  const color = accountColor(alert.account) ?? 'var(--link)'
  return (
    <DragRow
      className="drag-card"
      unread={!alert.opened}
      leaves={() => true}
      onDrag={(action) => onAction(dragAction(alert, action))}
    >
      <div
        className={`reminder-alert mail-card${alert.opened ? ' opened' : ''}${single ? ' single' : ''}${fading ? ' fading' : ''}`}
        style={{ borderLeftColor: color, '--account': color } as CSSProperties}
      >
        <button className="reminder-alert-body" onClick={onRead} title={t('Read')}>
          <span className="mail-card-top">
            <span className="mail-letter">{senderLetter(alert.from)}</span>
            <span className="mail-card-who">
              <span className="mail-card-line">
                <span className="mail-card-from">{alert.from}</span>
                <span className="mail-card-time">
                  {loading && <Spinner size={12} />}
                  {formatDue(alert.date)}
                </span>
              </span>
              <span className="mail-card-account">
                <span className="mail-dot" />
                <span className="mail-alert-account">{alert.account}</span>
              </span>
            </span>
          </span>
          <span className="mail-card-subject">{alert.subject}</span>
          {alert.snippet && <span className="reminder-alert-note">{alert.snippet}</span>}
        </button>
        <MailBar opened={alert.opened} onAction={onAction} />
      </div>
    </DragRow>
  )
}

// The sender's first letter or digit, in the round badge ("?" when there's none)
function senderLetter(from: string) {
  return [...from].find((c) => /[\p{L}\p{N}]/u.test(c))?.toUpperCase() ?? '?'
}

// An older email, as one line below the newest one's card (mockup H, from D): the sender's
// letter (small), sender (bold until opened), subject, when, then the card's 3 actions as icons.
// The account only by its color (strip + letter). A click on the line opens it, like a card.
function MailRow({ alert, fading, loading, onAction, onRead }: {
  alert: MailAlert
  fading: boolean
  loading: boolean
  onAction: (action: MailAction) => void
  onRead: () => void
}) {
  const color = accountColor(alert.account) ?? 'var(--link)'
  return (
    <DragRow
      className="drag-card"
      unread={!alert.opened}
      leaves={() => true}
      onDrag={(action) => onAction(dragAction(alert, action))}
    >
      <div
        className={`reminder-alert mail-line${alert.opened ? ' opened' : ''}${fading ? ' fading' : ''}`}
        style={{ borderLeftColor: color, '--account': color } as CSSProperties}
      >
        <button className="mail-line-body" onClick={onRead} title={t('Read')}>
          <span className="mail-letter">{senderLetter(alert.from)}</span>
          <span className="mail-line-from">{alert.from}</span>
          <span className="mail-line-subject">{alert.subject}</span>
          <span className="mail-card-time">
            {loading && <Spinner size={12} />}
            {lineTime(alert.date)}
          </span>
        </button>
        {cardActions(alert.opened).map((button) => (
          <button
            key={button.action}
            className={`mail-line-button${button.primary ? ' primary' : ''}${button.action === 'mail-delete' ? ' delete' : ''}`}
            onClick={() => onAction(button.action)}
            title={button.label}
            aria-label={button.label}
          >
            {button.icon}
          </button>
        ))}
      </div>
    </DragRow>
  )
}

// A row's time: today's only the clock ("14:32", the card above says the day), else as in the
// notes list ("Yesterday, 09:10", "14 Oct 2026"): the subject needs the room
const lineTime = (time: number) => (new Date(time).toDateString() === new Date().toDateString() ? clockTime(time) : dayTime(time))

// A card's 3 actions, also the icons of a row: a new mail: ✓ Mark as read (blue) · Keep unread ·
// trash; one already opened (so read): ✓ Done · Mark as unread · trash (to Gmail's Trash, no
// question, like the Mail tab's menu)
function cardActions(opened?: boolean): { action: MailAction; label: string; icon: ReactNode; primary?: boolean }[] {
  return [
    { action: opened ? 'mail-close' : 'mail-read', label: opened ? t('Done') : t('Mark as read'), icon: <Check size={15} />, primary: true },
    { action: opened ? 'mail-unread' : 'mail-keep', label: opened ? t('Mark as unread') : t('Keep unread'), icon: <Mail size={15} /> },
    { action: 'mail-delete', label: t('Delete'), icon: <Trash2 size={15} /> },
  ]
}

// A card's buttons as one flat bar across its bottom: icon + word, the trash alone at the end.
// Also under the mail in the reader (MailReader.tsx), pop-up and Mail tab
export function MailBar({ opened, onAction }: { opened?: boolean; onAction: (action: MailAction) => void }) {
  return (
    <div className="card-bar">
      {cardActions(opened).map((button) =>
        button.action === 'mail-delete' ? (
          <button key={button.action} className="card-bar-delete" onClick={() => onAction(button.action)} title={button.label} aria-label={button.label}>
            {button.icon}
          </button>
        ) : (
          <button key={button.action} className={button.primary ? 'primary' : undefined} onClick={() => onAction(button.action)}>
            {button.icon}
            {button.label}
          </button>
        ),
      )}
    </div>
  )
}

// A mail's top line in the reader: when it came + which account
export function MailWhen({ alert }: { alert: Pick<MailAlert, 'date' | 'account'> }) {
  return (
    <span className="reminder-alert-due">
      <Mail size={12} /> {formatDue(alert.date)} · <span className="mail-alert-account" title={alert.account}>{alert.account}</span>
    </span>
  )
}

// The account's color (Settings → Gmail), else the accent blue
export function accountColor(email: string) {
  const color = loadAccounts().find((a) => a.email === email)?.color
  return color ? `var(--text-${color})` : undefined
}

// The newest email's card, the older ones as rows below it (when the card goes, the next one
// becomes the card), with "N new emails · Mark all read" above them when there are 2 or more
export function MailCards({ alerts, fading, loadingKey = null, onAction, onRead }: {
  alerts: MailAlert[]
  fading: Set<string> // keys of cards fading out by themselves
  loadingKey?: string | null // the card whose mail is loading to be read
  onAction: (alert: MailAlert, action: MailAction) => void
  onRead: (alert: MailAlert) => void
}) {
  if (alerts.length === 0) return null
  const all = (action: MailAction) => alerts.forEach((alert) => onAction(alert, action))
  return (
    <>
      {alerts.length > 1 && (
        <div className="reminder-alerts-head">
          <span>{plural(alerts.length, '{n} new email', '{n} new emails')}</span>
          <button onClick={() => all('mail-read')}>{t('Mark all read')}</button>
        </div>
      )}
      {alerts.map((alert, i) => {
        const props = {
          alert,
          fading: fading.has(alert.key),
          loading: alert.key === loadingKey,
          onAction: (action: MailAction) => onAction(alert, action),
          onRead: () => onRead(alert),
        }
        return i === 0 ? <MailCard key={alert.key} {...props} single={alerts.length === 1} /> : <MailRow key={alert.key} {...props} />
      })}
    </>
  )
}
