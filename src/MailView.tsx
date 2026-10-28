import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useListItems, usePage } from './animations'
import ContextMenu from './ContextMenu'
import { useGmailAccounts } from './gmail'
import { openLink } from './links'
import { accountColor } from './MailCards'
import MailReader from './MailReader'
import { changeMail, gmailLink, useMissed, type MailAlert } from './mailAlerts'
import { useMailbox } from './mailbox'
import { formatDue } from './reminders'
import Spinner from './Spinner'

// The Mail tab (PC): unread mail in Primary of all Gmail accounts (mailbox.ts), laid out like
// the Reminders tab. "Missed" on top: emails whose pop-up faded by itself; then the others.
// A click reads the mail here, in the pop-up's reader (MailReader.tsx), and marks it read; ←
// Back, Done or Escape return to the list. Right-click: Mark as read / unread, Remove from
// Missed, Archive, Open in Gmail. A mail marked read here stays in the list (dimmed) while the
// tab is open, so "Mark as unread" can undo it.
function MailView() {
  const pageRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  usePage(pageRef)
  useListItems(listRef)
  const accounts = useGmailAccounts()
  const missed = useMissed()
  const { rows, errors, loading, refresh } = useMailbox()
  const [readHere, setReadHere] = useState<MailAlert[]>([]) // marked read in this tab
  const [archived, setArchived] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<{ mail: MailAlert; x: number; y: number } | null>(null)
  const [reading, setReading] = useState<MailAlert | null>(null)

  useEffect(() => {
    if (!reading) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setReading(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reading])

  const isRead = (mail: MailAlert) => readHere.some((m) => m.key === mail.key)
  const shown = [...(rows ?? []), ...readHere.filter((m) => !rows?.some((r) => r.key === m.key))]
    .filter((mail) => !archived.has(mail.key))
    .sort((a, b) => b.date - a.date)
  const missedRows = shown.filter((mail) => missed.includes(mail.key) && !isRead(mail))
  const otherRows = shown.filter((mail) => !missedRows.includes(mail))

  // Shown right away; if Gmail can't be reached, the next refresh shows the real state
  function change(mail: MailAlert, what: 'read' | 'unread' | 'archive' | 'keep') {
    if (what === 'read') setReadHere((list) => [...list, mail])
    if (what === 'unread') setReadHere((list) => list.filter((m) => m.key !== mail.key))
    if (what === 'archive') setArchived((keys) => new Set(keys).add(mail.key))
    changeMail(mail.key, what).catch((error) => console.error(error))
  }

  function read(mail: MailAlert) {
    listScroll.current = pageRef.current?.scrollTop ?? 0
    setReading(mail)
    if (!isRead(mail)) change(mail, 'read')
  }

  function row(mail: MailAlert) {
    return (
      <button
        key={mail.key}
        data-item={mail.key}
        className={`reminder-row mail-row${isRead(mail) ? ' read' : ''}`}
        onClick={() => read(mail)}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ mail, x: e.clientX, y: e.clientY })
        }}
        title={`${mail.account} (right-click for more)`}
      >
        <span className="menu-swatch" style={{ background: accountColor(mail.account) ?? 'var(--link)' }} />
        <span className="reminder-row-text">
          <span className="reminder-text">
            <span className="mail-row-from">{mail.from}</span> · {mail.subject}
          </span>
          {mail.snippet && <span className="reminder-row-note">{mail.snippet}</span>}
        </span>
        <span className="reminder-due">{isRead(mail) ? 'Read' : formatDue(mail.date)}</span>
      </button>
    )
  }

  function group(title: string, list: MailAlert[]) {
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
            <button className="reminders-refresh" onClick={refresh} disabled={loading} title="Refresh from Gmail">
              {loading ? <Spinner label="Refreshing" /> : <RefreshCw size={15} />}
            </button>
          </div>
        </div>
        {accounts.length === 0 && <p className="games-empty">Add a Gmail account in Settings → Gmail</p>}
        {errors.length > 0 && (
          <p className="games-empty">Couldn't reach Gmail for {errors.join(', ')} (offline?)</p>
        )}
        {rows && accounts.length > 0 && shown.length === 0 && <p className="games-empty">No unread mail in Primary</p>}
        {group('Missed', missedRows)}
        {group('Unread', otherRows)}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Open in Gmail', onClick: () => openLink(gmailLink(menu.mail)) },
            isRead(menu.mail)
              ? { label: 'Mark as unread', onClick: () => change(menu.mail, 'unread') }
              : { label: 'Mark as read', onClick: () => change(menu.mail, 'read') },
            ...(missedRows.includes(menu.mail)
              ? [{ label: 'Remove from Missed', onClick: () => change(menu.mail, 'keep') }]
              : []),
            { label: 'Archive', divider: true, onClick: () => change(menu.mail, 'archive') },
          ]}
        />
      )}
    </main>
  )
}

export default MailView
