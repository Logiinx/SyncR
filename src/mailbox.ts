import { useCallback, useEffect, useRef, useState } from 'react'
import { gmailApi, loadAccounts } from './gmail'
import { fetchAlert, QUERY, type MailAlert } from './mailAlerts'

// The Mail tab's list (MailView.tsx): the last 50 mails in Primary of every Gmail account
// that's on, read or not, plus any older unread ones; newest first, live from Gmail. Loaded
// when the tab opens, with its refresh button, and whenever the minute check or instant mail
// sees a change in a mailbox (mailbox-change: new mail, mail read or marked unread in Gmail…),
// and again after a failed load (RETRY_MS).

export const MAIL_TAB = 'mail' // its id among the open tabs (like GAMES_TAB)
const RECENT = 'in:inbox category:primary' // QUERY without is:unread
const MAX_ROWS = 50
// After a failed load (e.g. right at start, before the network or the proxy answers): tried
// again by itself, soon at first, then every minute, and as soon as the PC is back online
const RETRY_MS = [5000, 15_000, 60_000]

export type MailboxRow = MailAlert & { unread: boolean }

// Gmail refuses an account's requests when too many run at once (it fails the load, e.g. at
// start, when the minute check's mailbox-change starts a second load during the first one)
const MAX_PARALLEL = 10

// A mail's sender, subject… never change: fetched once. The request itself is kept, so
// overlapping loads share it; a failed one is dropped (asked again next time).
const cache = new Map<string, Promise<MailAlert>>()

function cachedAlert(email: string, id: string) {
  const key = `mail:${email}:${id}`
  let alert = cache.get(key)
  if (!alert) {
    alert = fetchAlert(email, id)
    cache.set(key, alert)
    alert.catch(() => cache.get(key) === alert && cache.delete(key))
  }
  return alert
}

// Like Promise.all(items.map(fn)), with at most `limit` running at a time
async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results: R[] = []
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

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
        ...(await mapLimited([...new Set([...recent, ...unread])], MAX_PARALLEL, async (id) => ({
          ...(await cachedAlert(email, id)),
          unread: unreadIds.has(id),
        }))),
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
  const retry = useRef<{ timer?: number; count: number }>({ count: 0 })

  // Loads can overlap (refresh button, a change in Gmail): only the last one started is shown
  const refresh = useCallback(async () => {
    const load = ++lastLoad.current
    clearTimeout(retry.current.timer)
    const startedAt = Date.now()
    setLoading(true)
    const result = await loadInbox()
    if (load !== lastLoad.current) return
    setRows(result.rows)
    setErrors(result.errors)
    setLoadedFrom(startedAt)
    setLoading(false)
    if (result.errors.length === 0) retry.current.count = 0
    else retry.current.timer = window.setTimeout(refresh, RETRY_MS[Math.min(retry.current.count++, RETRY_MS.length - 1)])
  }, [])

  useEffect(() => {
    refresh()
    window.addEventListener('mailbox-change', refresh)
    window.addEventListener('gmail-change', refresh)
    window.addEventListener('online', refresh)
    return () => {
      lastLoad.current++ // a load still running when the tab closes is dropped (no retry timer)
      clearTimeout(retry.current.timer)
      window.removeEventListener('online', refresh)
      window.removeEventListener('mailbox-change', refresh)
      window.removeEventListener('gmail-change', refresh)
    }
  }, [refresh])

  return { rows, errors, loading, loadedFrom, refresh }
}
