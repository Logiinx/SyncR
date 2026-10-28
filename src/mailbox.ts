import { useCallback, useEffect, useState } from 'react'
import { gmailApi, loadAccounts } from './gmail'
import { fetchAlert, QUERY, type MailAlert } from './mailAlerts'

// The Mail tab's list (MailView.tsx): unread mail in Primary of every Gmail account that's on,
// newest first, live from Gmail. Loaded when the tab opens, with its refresh button, and when
// the minute check finds new mail (mail-alerts-change).

export const MAIL_TAB = 'mail' // its id among the open tabs (like GAMES_TAB)

const cache = new Map<string, MailAlert>() // a mail's sender, subject… never change: fetched once

async function loadInbox() {
  const rows: MailAlert[] = []
  const errors: string[] = []
  for (const { email } of loadAccounts().filter((a) => a.enabled && !a.expired)) {
    try {
      const list = await gmailApi(email, `messages?q=${encodeURIComponent(QUERY)}&maxResults=50`)
      const ids: string[] = (list?.messages ?? []).map((m: { id: string }) => m.id)
      rows.push(
        ...(await Promise.all(
          ids.map(async (id) => {
            const key = `mail:${email}:${id}`
            if (!cache.has(key)) cache.set(key, await fetchAlert(email, id))
            return cache.get(key)!
          }),
        )),
      )
    } catch (error) {
      console.error(error)
      errors.push(email)
    }
  }
  return { rows: rows.sort((a, b) => b.date - a.date), errors }
}

export function useMailbox() {
  const [rows, setRows] = useState<MailAlert[] | null>(null) // null: first load
  const [errors, setErrors] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    const result = await loadInbox()
    setRows(result.rows)
    setErrors(result.errors)
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
    window.addEventListener('mail-alerts-change', refresh)
    window.addEventListener('gmail-change', refresh)
    return () => {
      window.removeEventListener('mail-alerts-change', refresh)
      window.removeEventListener('gmail-change', refresh)
    }
  }, [refresh])

  return { rows, errors, loading, refresh }
}
