import { useEffect, useSyncExternalStore } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { errorDetails, gmailApi, gmailErrorText, loadAccounts } from './gmail'
import { fetchAlert, QUERY, type MailAlert } from './mailAlerts'

// The Mail tab's list (MailView.tsx): the last 50 mails in Primary of every Gmail account
// that's on, read or not, plus any older unread ones; newest first, live from Gmail. Kept in
// memory while SyncR runs (never saved), so the tab opens at once: loaded a few seconds after
// start (startMailbox), again when the tab opens (in the background, the old list stays shown),
// with its refresh button, whenever the minute check or instant mail sees a change in a mailbox
// (mailbox-change: new mail, mail read or marked unread in Gmail…), and after a failed load (RETRY_MS).

export const MAIL_TAB = 'mail' // its id among the open tabs (like GAMES_TAB)
const RECENT = 'in:inbox category:primary' // QUERY without is:unread
const MAX_ROWS = 50
// After a failed load (e.g. right at start, before the network or the proxy answers): tried
// again by itself, soon at first, then every minute, and as soon as the PC is back online
const RETRY_MS = [5000, 15_000, 60_000]

export type MailboxRow = MailAlert & { unread: boolean }
// An account whose mail couldn't load: what went wrong in plain words, and Gmail's own words
export type MailboxError = { email: string; text: string; details: string }

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
  const errors: MailboxError[] = []
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
      errors.push({ email, text: gmailErrorText(error), details: errorDetails(error) })
    }
  }
  rows.sort((a, b) => b.date - a.date)
  return { rows: rows.filter((row, i) => i < MAX_ROWS || row.unread), errors }
}

type Mailbox = {
  rows: MailboxRow[] | null // null: first load
  errors: MailboxError[]
  loading: boolean
  loadedFrom: number // when the shown list's load started (ms)
}
let mailbox: Mailbox = { rows: null, errors: [], loading: false, loadedFrom: 0 }
const listeners = new Set<() => void>()
const setMailbox = (change: Partial<Mailbox>) => {
  mailbox = { ...mailbox, ...change }
  listeners.forEach((listener) => listener())
}

// Loads can overlap (refresh button, a change in Gmail): only the last one started is shown
let lastLoad = 0
let retryTimer: number | undefined
let retryCount = 0
export async function refreshMailbox() {
  const load = ++lastLoad
  clearTimeout(retryTimer)
  const startedAt = Date.now()
  setMailbox({ loading: true })
  const result = await loadInbox()
  if (load !== lastLoad) return
  setMailbox({ rows: result.rows, errors: result.errors, loadedFrom: startedAt, loading: false })
  if (result.errors.length === 0) retryCount = 0
  else retryTimer = window.setTimeout(refreshMailbox, RETRY_MS[Math.min(retryCount++, RETRY_MS.length - 1)])
}

// Started once by the app (PC; in the browser only while developing): the first load waits a
// few seconds (the minute check also asks Gmail right at start), then follows every change
const FIRST_LOAD_AFTER = 5000
let started = false
export function startMailbox() {
  if (started || (!isTauri() && !import.meta.env.DEV)) return
  started = true
  window.setTimeout(() => !mailbox.loading && !mailbox.rows && refreshMailbox(), FIRST_LOAD_AFTER)
  for (const event of ['mailbox-change', 'gmail-change', 'online']) window.addEventListener(event, refreshMailbox)
}

export function useMailbox() {
  const shown = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => mailbox,
  )
  // Opening the tab: a fresh list in the background (unless one is loading already)
  useEffect(() => {
    if (!mailbox.loading) refreshMailbox()
  }, [])
  return { ...shown, refresh: refreshMailbox }
}
