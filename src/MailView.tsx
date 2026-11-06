import { useEffect, useRef, useState } from 'react'
import { t } from './i18n'
import { Archive, BellOff, ExternalLink, Mail, MailOpen, RefreshCw, Trash2 } from 'lucide-react'
import { useListItems, usePage } from './animations'
import ContextMenu from './ContextMenu'
import { useGmailAccounts } from './gmail'
import { openLink } from './links'
import { accountColor } from './MailCards'
import MailReader from './MailReader'
import { changeMail, gmailLink, useMissed, type MailAlert } from './mailAlerts'
import { newestMails, useMailbox, type MailboxRow } from './mailbox'
import { useLocalState } from './localState'
import { formatDue } from './reminders'
import Spinner from './Spinner'

// A change made in the Mail tab; doneAt: when Gmail took it (ms)
type LocalChange = { what: 'read' | 'unread' | 'gone'; doneAt?: number }

// The Mail tab (PC): the last mails in Primary of all Gmail accounts, read or not (mailbox.ts),
// laid out like the Reminders tab; unread ones in bold, "Unread only" hides the others. With 2+
// accounts on, one box per account picks whose mail shows (at least one stays ticked); it only
// changes this list, not the alerts or the Missed count on the tab.
// "Missed" on top: unread emails whose pop-up faded by itself; then the others. A click reads
// the mail here, in the pop-up's reader (MailReader.tsx), and marks it read; ‹ Back, ✕, Done or
// Escape return to the list. Right-click (sender and subject on top): Mark as read / unread,
// Remove from Missed, Archive, Open in Gmail, Delete (to Gmail's Trash, without asking).
function MailView() {
  const pageRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  usePage(pageRef)
  const accounts = useGmailAccounts()
  const missed = useMissed()
  const { rows, errors: allErrors, loading, loadedFrom, refresh } = useMailbox()
  const [unreadOnly, setUnreadOnly] = useLocalState('syncr.mail.unreadOnly', false)
  // Unticked accounts are the ones stored, so a new account starts ticked. If every one is
  // unticked (the only ticked one was turned off in Settings), all show.
  const [hiddenAccounts, setHiddenAccounts] = useLocalState<string[]>('syncr.mail.hiddenAccounts', [])
  const accountsOn = accounts.filter((a) => a.enabled).map((a) => a.email)
  const ticked = accountsOn.filter((email) => !hiddenAccounts.includes(email))
  const shownAccounts = ticked.length > 0 ? ticked : accountsOn
  const errors = allErrors.filter((error) => shownAccounts.includes(error.email))
  // Switching filter changes the list all at once: no item animations
  useListItems(listRef, `${unreadOnly}-${shownAccounts.join()}`)
  // Changed here (marked read / unread, archived or deleted: "gone"), shown right away. Kept
  // until a list whose load started after Gmail took the change (one already loading still
  // has the old state); dropped at once if Gmail refused it (the list's state is the real one).
  const [changes, setChanges] = useState<Map<string, LocalChange>>(new Map())
  const [menu, setMenu] = useState<{ mail: MailboxRow; x: number; y: number } | null>(null)
  const [reading, setReading] = useState<MailAlert | null>(null)

  useEffect(() => {
    setChanges((map) => new Map([...map].filter(([, change]) => change.doneAt === undefined || change.doneAt > loadedFrom)))
  }, [rows, loadedFrom])

  useEffect(() => {
    if (!reading) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setReading(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reading])

  const isUnread = (mail: MailboxRow) => {
    const local = changes.get(mail.key)?.what
    return local === 'read' || local === 'unread' ? local === 'unread' : mail.unread
  }
  const shown = newestMails((rows ?? []).filter((mail) => shownAccounts.includes(mail.account))).filter(
    (mail) => changes.get(mail.key)?.what !== 'gone',
  )
  const missedRows = shown.filter((mail) => missed.includes(mail.key) && isUnread(mail))
  const otherRows = shown.filter((mail) => !missedRows.includes(mail) && (!unreadOnly || isUnread(mail)))

  function toggleAccount(email: string, on: boolean) {
    const next = on ? [...shownAccounts, email] : shownAccounts.filter((other) => other !== email)
    setHiddenAccounts(accountsOn.filter((other) => !next.includes(other)))
  }

  function change(mail: MailAlert, what: 'read' | 'unread' | 'archive' | 'trash' | 'keep') {
    if (what === 'keep') return void changeMail(mail.key, what) // only the "missed" mark
    const entry: LocalChange = { what: what === 'archive' || what === 'trash' ? 'gone' : what }
    setChanges((map) => new Map(map).set(mail.key, entry))
    // Only if it's still this change (not one made after it)
    const settle = (doneAt?: number) =>
      setChanges((map) => {
        if (map.get(mail.key) !== entry) return map
        const next = new Map(map)
        if (doneAt) next.set(mail.key, { ...entry, doneAt })
        else next.delete(mail.key)
        return next
      })
    changeMail(mail.key, what).then(
      () => settle(Date.now()),
      (error) => {
        console.error(error)
        settle()
      },
    )
  }

  function read(mail: MailboxRow) {
    listScroll.current = pageRef.current?.scrollTop ?? 0
    setReading(mail)
    if (isUnread(mail)) change(mail, 'read')
  }

  function row(mail: MailboxRow) {
    return (
      <button
        key={mail.key}
        data-item={mail.key}
        className={`reminder-row mail-row${isUnread(mail) ? ' unread' : ''}`}
        onClick={() => read(mail)}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ mail, x: e.clientX, y: e.clientY })
        }}
        title={mail.account}
      >
        <span className="menu-swatch" style={{ background: accountColor(mail.account) ?? 'var(--link)' }} />
        <span className="reminder-row-text">
          <span className="reminder-text" title={`${mail.from} · ${mail.subject}`}>
            {mail.from} · {mail.subject}
          </span>
          {mail.snippet && <span className="reminder-row-note" title={mail.snippet}>{mail.snippet}</span>}
        </span>
        <span className="reminder-due">{formatDue(mail.date)}</span>
      </button>
    )
  }

  function group(title: string, list: MailboxRow[]) {
    if (list.length === 0) return null
    return (
      <section className="games-group">
        <h3 className="games-group-title">
          {title} <span className="games-count">{list.length}</span>
        </h3>
        {list.map(row)}
      </section>
    )
  }

  // The list stays (hidden) while a mail is read, so Back finds it as it was, scroll included
  const listScroll = useRef(0)
  useEffect(() => {
    const page = pageRef.current
    if (page && !reading) page.scrollTop = listScroll.current
  }, [reading])

  return (
    <main className="page games-page" ref={pageRef}>
      {reading && (
        <div className="mail-view-reader">
          <MailReader
            alert={reading}
            onBack={() => setReading(null)}
            onAction={(action) => {
              if (action === 'mail-unread') change(reading, 'unread')
              if (action === 'mail-delete') change(reading, 'trash')
              setReading(null) // Done, ✕, Mark as unread, Delete
            }}
          />
        </div>
      )}
      <div className="games" ref={listRef} hidden={reading !== null}>
        <div className="games-views reminders-toolbar">
          <div className="reminders-tools mail-tools">
            {accountsOn.length > 1 &&
              accountsOn.map((email) => {
                const on = shownAccounts.includes(email)
                const last = on && shownAccounts.length === 1
                return (
                  <label
                    key={email}
                    className="reminders-hide-repeating mail-account-filter"
                    title={last ? t('At least one account stays shown') : t('Show this account’s mail')}
                  >
                    {/* Not "disabled" for the last one: a disabled box looks unticked in the dark theme */}
                    <input type="checkbox" checked={on} aria-disabled={last} onChange={(e) => !last && toggleAccount(email, e.target.checked)} />
                    <span className="menu-swatch" style={{ background: accountColor(email) ?? 'var(--link)' }} />
                    {email}
                  </label>
                )
              })}
            <label className="reminders-hide-repeating" title={t('Show only unread mail')}>
              <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
              {t('Unread only')}
            </label>
            <button className="reminders-refresh" onClick={refresh} disabled={loading} title={t('Refresh from Gmail')}>
              {loading ? <Spinner label={t('Refreshing')} /> : <RefreshCw size={15} />}
            </button>
          </div>
        </div>
        {accounts.length === 0 && <p className="games-empty">{t('Add a Gmail account in Settings → Accounts.')}</p>}
        {errors.map(({ email, text, details, retry }) => (
          <p key={email} className="games-empty error" title={details || undefined}>
            {email}: {text}{retry && t('. Trying again…')}
          </p>
        ))}
        {/* Before the first list (right after start): placeholder rows shaped like mails */}
        {!rows && accounts.length > 0 && errors.length === 0 && (
          <section className="games-group" aria-label={t('Loading mail')}>
            {[62, 48, 70, 55, 66, 44].map((width, i) => (
              <div key={i} className="reminder-row mail-row">
                <span className="menu-swatch skeleton" />
                <span className="reminder-row-text">
                  <span className="skeleton" style={{ width: `${width}%` }} />
                  <span className="skeleton" style={{ width: `${width + 20}%`, height: '0.75em' }} />
                </span>
                <span className="skeleton" style={{ width: '3em' }} />
              </div>
            ))}
          </section>
        )}
        {rows && accounts.length > 0 && errors.length === 0 && missedRows.length + otherRows.length === 0 && (
          <p className="games-empty">{unreadOnly ? t('No unread mail in Primary') : t('No mail in Primary')}</p>
        )}
        {group(t('Missed'), missedRows)}
        {group(unreadOnly ? t('Unread') : t('Inbox'), otherRows)}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          header={{ title: menu.mail.from, subtitle: menu.mail.subject }}
          // "Open in …" after the mail's own actions, like a Reminders event's menu
          items={[
            isUnread(menu.mail)
              ? { label: t('Mark as read'), icon: MailOpen, onClick: () => change(menu.mail, 'read') }
              : { label: t('Mark as unread'), icon: Mail, onClick: () => change(menu.mail, 'unread') },
            ...(missedRows.includes(menu.mail)
              ? [{ label: t('Remove from Missed'), icon: BellOff, onClick: () => change(menu.mail, 'keep') }]
              : []),
            { label: t('Archive'), icon: Archive, onClick: () => change(menu.mail, 'archive') },
            { label: t('Open in Gmail'), icon: ExternalLink, onClick: () => openLink(gmailLink(menu.mail)) },
            { label: t('Delete'), icon: Trash2, danger: true, onClick: () => change(menu.mail, 'trash') },
          ]}
        />
      )}
    </main>
  )
}

export default MailView
