import { useEffect, useRef, useState } from 'react'
import { Archive, BellOff, ExternalLink, Mail, MailOpen, RefreshCw, Trash2 } from 'lucide-react'
import { useListItems, usePage } from './animations'
import ContextMenu from './ContextMenu'
import { useGmailAccounts } from './gmail'
import { openLink } from './links'
import { accountColor } from './MailCards'
import MailReader from './MailReader'
import { changeMail, gmailLink, useMissed, type MailAlert } from './mailAlerts'
import { useMailbox, type MailboxRow } from './mailbox'
import { useLocalState } from './localState'
import { formatDue } from './reminders'
import Spinner from './Spinner'

// The Mail tab (PC): the last mails in Primary of all Gmail accounts, read or not (mailbox.ts),
// laid out like the Reminders tab; unread ones in bold, "Unread only" hides the others.
// "Missed" on top: unread emails whose pop-up faded by itself; then the others. A click reads
// the mail here, in the pop-up's reader (MailReader.tsx), and marks it read; ← Back, Done or
// Escape return to the list. Right-click (sender and subject on top): Open in Gmail, Mark as
// read / unread, Remove from Missed, Archive, Delete (to Gmail's Trash, without asking).
function MailView() {
  const pageRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  usePage(pageRef)
  useListItems(listRef)
  const accounts = useGmailAccounts()
  const missed = useMissed()
  const { rows, errors, loading, refresh } = useMailbox()
  const [unreadOnly, setUnreadOnly] = useLocalState('syncr.mail.unreadOnly', false)
  // Marked read / unread here: shown right away, until the list comes back from Gmail
  const [marked, setMarked] = useState<Map<string, boolean>>(new Map())
  const [removed, setRemoved] = useState<Set<string>>(new Set()) // archived or deleted here
  const [menu, setMenu] = useState<{ mail: MailboxRow; x: number; y: number } | null>(null)
  const [reading, setReading] = useState<MailAlert | null>(null)

  useEffect(() => setMarked(new Map()), [rows])

  useEffect(() => {
    if (!reading) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setReading(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reading])

  const isUnread = (mail: MailboxRow) => marked.get(mail.key) ?? mail.unread
  const shown = (rows ?? []).filter((mail) => !removed.has(mail.key))
  const missedRows = shown.filter((mail) => missed.includes(mail.key) && isUnread(mail))
  const otherRows = shown.filter((mail) => !missedRows.includes(mail) && (!unreadOnly || isUnread(mail)))

  // Shown right away; if Gmail can't be reached, the next refresh shows the real state
  function change(mail: MailAlert, what: 'read' | 'unread' | 'archive' | 'trash' | 'keep') {
    if (what === 'read' || what === 'unread') setMarked((map) => new Map(map).set(mail.key, what === 'unread'))
    if (what === 'archive' || what === 'trash') setRemoved((keys) => new Set(keys).add(mail.key))
    changeMail(mail.key, what).catch((error) => console.error(error))
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
        title={`${mail.account} (right-click for more)`}
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
              if (action === 'mail-open') return openLink(gmailLink(reading))
              if (action === 'mail-unread') change(reading, 'unread')
              setReading(null) // Done, Mark as unread
            }}
          />
        </div>
      )}
      <div className="games" ref={listRef} hidden={reading !== null}>
        <div className="games-views reminders-toolbar">
          <div className="reminders-tools">
            <label className="reminders-hide-repeating" title="Show only unread mail">
              <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
              Unread only
            </label>
            <button className="reminders-refresh" onClick={refresh} disabled={loading} title="Refresh from Gmail">
              {loading ? <Spinner label="Refreshing" /> : <RefreshCw size={15} />}
            </button>
          </div>
        </div>
        {accounts.length === 0 && <p className="games-empty">Add a Gmail account in Settings → Accounts.</p>}
        {errors.length > 0 && (
          <p className="games-empty">Couldn't reach Gmail for {errors.join(', ')} (offline?)</p>
        )}
        {rows && accounts.length > 0 && missedRows.length + otherRows.length === 0 && (
          <p className="games-empty">{unreadOnly ? 'No unread mail in Primary' : 'No mail in Primary'}</p>
        )}
        {group('Missed', missedRows)}
        {group(unreadOnly ? 'Unread' : 'Inbox', otherRows)}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          header={{ title: menu.mail.from, subtitle: menu.mail.subject }}
          items={[
            { label: 'Open in Gmail', icon: ExternalLink, onClick: () => openLink(gmailLink(menu.mail)) },
            isUnread(menu.mail)
              ? { label: 'Mark as read', icon: MailOpen, divider: true, onClick: () => change(menu.mail, 'read') }
              : { label: 'Mark as unread', icon: Mail, divider: true, onClick: () => change(menu.mail, 'unread') },
            ...(missedRows.includes(menu.mail)
              ? [{ label: 'Remove from Missed', icon: BellOff, onClick: () => change(menu.mail, 'keep') }]
              : []),
            { label: 'Archive', icon: Archive, onClick: () => change(menu.mail, 'archive') },
            { label: 'Delete', icon: Trash2, danger: true, onClick: () => change(menu.mail, 'trash') },
          ]}
        />
      )}
    </main>
  )
}

export default MailView
