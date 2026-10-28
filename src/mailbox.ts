import { useCallback, useEffect, useRef, useState } from 'react'
import { gmailApi, loadAccounts } from './gmail'
import { fetchAlert, QUERY, type MailAlert } from './mailAlerts'

// The Mail tab's list (MailView.tsx): the last 50 mails in Primary of every Gmail account
// that's on, read or not, plus any older unread ones; newest first, live from Gmail. Loaded
// when the tab opens, with its refresh button, and whenever the minute check or instant mail
// sees a change in a mailbox (mailbox-change: new mail, mail read or marked unread in Gmail…).

export const MAIL_TAB = 'mail' // its id among the open tabs (like GAMES_TAB)
const RECENT = 'in:inbox category:primary' // QUERY without is:unread
const MAX_ROWS = 50

export type MailboxRow = MailAlert & { unread: boolean }

const cache = new Map<string, MailAlert>() // a mail's sender, subject… never change: fetched once

async function listIds(email: string, query: string): Promise<string[]> {
  const list = await gmailApi(email, `messages?q=${encodeURIComponent(query)}&maxResults=${MAX_ROWS}`)
  return (list?.messages ?? []).map((m: { id: string }) => m.id)
}

async function loadInbox() {
  const rows: MailboxRow[] = []
  const errors: string[] = []
  for (const { email } of loadAccounts().filter((a) => a.enabled && !a.expired)) {
    try {
      const [recent, unread] = await Promise.all([listIds(email, RECENT), listIds(email, QUERY)])
      const unreadIds = new Set(unread)
      rows.push(
        ...(await Promise.all(
          [...new Set([...recent, ...unread])].map(async (id) => {
            const key = `mail:${email}:${id}`
            if (!cache.has(key)) cache.set(key, await fetchAlert(email, id))
            return { ...cache.get(key)!, unread: unreadIds.has(id) }
          }),
        )),
      )
    } catch (error) {
      console.error(error)
      errors.push(email)
    }
  }
  rows.sort((a, b) => b.date - a.date)
  return { rows: rows.filter((row, i) => i < MAX_ROWS || row.unread), errors }
}

export function useMailbox() {
  const [rows, setRows] = useState<MailboxRow[] | null>(null) // null: first load
  const [errors, setErrors] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [loadedFrom, setLoadedFrom] = useState(0) // when the shown list's load started (ms)
  const lastLoad = useRef(0)

  // Loads can overlap (refresh button, a change in Gmail): only the last one started is shown
  const refresh = useCallback(async () => {
    const load = ++lastLoad.current
    const startedAt = Date.now()
    setLoading(true)
    const result = await loadInbox()
    if (load !== lastLoad.current) return
    setRows(result.rows)
    setErrors(result.errors)
    setLoadedFrom(startedAt)
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
    window.addEventListener('mailbox-change', refresh)
    window.addEventListener('gmail-change', refresh)
    return () => {
      window.removeEventListener('mailbox-change', refresh)
      window.removeEventListener('gmail-change', refresh)
    }
  }, [refresh])

  return { rows, errors, loading, loadedFrom, refresh }
}
