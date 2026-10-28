import { useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { gmailApi, loadAccounts } from './gmail'
import { openLink } from './links'
import { read, write } from './localState'

// New emails for the pop-up (PC). The main window checks each Gmail account that's on every
// minute (useMailCheck) and keeps the cards to show in localStorage, which the pop-up window
// reads too (same origin) and follows through "storage" events.
// Only mail that's new since the account was first checked shows: unread mail already there
// then doesn't pop up. A card goes when its mail is read (here, in Gmail or on the phone), or
// with "Keep unread" (the mail stays unread).

export interface MailAlert {
  key: string // "mail:<account>:<message id>"
  account: string // the Gmail address
  id: string // Gmail's message id
  threadId: string
  from: string // the sender's name (or address)
  subject: string
  snippet: string // the start of the text, from Gmail
  date: number // ms since epoch
}

export type MailAction = 'mail-read' | 'mail-keep' | 'mail-open'

const ALERTS_KEY = 'syncr.gmail.alerts'
const SEEN_KEY = 'syncr.gmail.seen' // per account: message ids already known (never shown again)
const CHECK_EVERY_MS = 60_000
const QUERY = 'in:inbox is:unread category:primary'
const MAX_SEEN = 500 // per account; new mail always has a new id, so older ones can go
const MAX_NEW = 10 // cards added per check and account at most (e.g. after a long time off)

export const loadMailAlerts = () => read<MailAlert[]>(ALERTS_KEY, [])

function saveMailAlerts(alerts: MailAlert[]) {
  write(ALERTS_KEY, alerts)
  window.dispatchEvent(new Event('mail-alerts-change')) // this window; others get "storage"
}

// The cards to show, newest first, kept current (also from the other window)
export function useMailAlerts() {
  const [alerts, setAlerts] = useState(loadMailAlerts)
  useEffect(() => {
    const refresh = () => setAlerts(loadMailAlerts())
    const onStorage = (e: StorageEvent) => e.key === ALERTS_KEY && refresh()
    window.addEventListener('mail-alerts-change', refresh)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('mail-alerts-change', refresh)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  return alerts
}

// ---------- Checking ----------

let checking = false
// Cards closed during this run of SyncR: a check that started before keeps them out
const closed = new Set<string>()

// One check of all accounts. Errors (offline, Google down) leave that account as it was: the
// next check tries again.
export async function checkMail() {
  if (checking) return
  checking = true
  try {
    const accounts = loadAccounts().filter((a) => a.enabled && !a.expired)
    const seen = read<Record<string, string[]>>(SEEN_KEY, {})
    // Cards of accounts that were removed, turned off or signed out go
    let alerts = loadMailAlerts().filter((alert) => accounts.some((a) => a.email === alert.account))
    for (const { email } of accounts) {
      try {
        const list = await gmailApi(email, `messages?q=${encodeURIComponent(QUERY)}&maxResults=50`)
        const unread: { id: string; threadId: string }[] = list?.messages ?? []
        const unreadIds = new Set(unread.map((m) => m.id))
        const known = seen[email]
        const fresh = known ? unread.filter((m) => !known.includes(m.id)).slice(0, MAX_NEW) : [] // first check: none
        const added = await Promise.all(fresh.map((m) => fetchAlert(email, m.id)))
        alerts = [
          ...added,
          // Read since (anywhere): its card goes
          ...alerts.filter((alert) => alert.account !== email || unreadIds.has(alert.id)),
        ]
        seen[email] = [...new Set([...unreadIds, ...(known ?? [])])].slice(0, MAX_SEEN)
      } catch (error) {
        console.error(error)
      }
    }
    for (const email of Object.keys(seen)) {
      if (!loadAccounts().some((a) => a.email === email)) delete seen[email] // removed account
    }
    write(SEEN_KEY, seen)
    alerts = alerts.filter((alert) => !closed.has(alert.key)).sort((a, b) => b.date - a.date)
    if (JSON.stringify(alerts) !== JSON.stringify(loadMailAlerts())) saveMailAlerts(alerts)
  } finally {
    checking = false
  }
}

// A card's content: sender, subject, start of the text (Gmail's "metadata": no body)
async function fetchAlert(account: string, id: string): Promise<MailAlert> {
  const message = await gmailApi(account, `messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`)
  const header = (name: string) =>
    (message.payload?.headers ?? []).find((h: { name: string }) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
  return {
    key: `mail:${account}:${id}`,
    account,
    id,
    threadId: message.threadId,
    from: senderName(header('From')),
    subject: header('Subject') || '(no subject)',
    snippet: decodeEntities(message.snippet ?? ''),
    date: Number(message.internalDate) || Date.now(),
  }
}

// "Jane Doe <jane@example.com>" → Jane Doe; "<jane@example.com>" or a bare address → the address
function senderName(from: string) {
  const name = from.replace(/<[^>]*>/, '').replace(/"/g, '').trim()
  return name || from.replace(/[<>]/g, '').trim() || 'Unknown sender'
}

// Gmail's snippets come with HTML entities (&#39; &amp; …)
function decodeEntities(text: string) {
  return new DOMParser().parseFromString(text, 'text/html').documentElement.textContent ?? text
}

// Checks every minute while SyncR runs (PC; in the browser only while developing), and right
// away when accounts change (added, turned on).
export function useMailCheck() {
  useEffect(() => {
    if (!isTauri() && !import.meta.env.DEV) return
    const run = () => void checkMail().catch((error) => console.error(error))
    run()
    const timer = setInterval(run, CHECK_EVERY_MS)
    window.addEventListener('gmail-change', run)
    return () => {
      clearInterval(timer)
      window.removeEventListener('gmail-change', run)
    }
  }, [])
}

// ---------- Card buttons ----------

function removeAlert(key: string) {
  closed.add(key)
  saveMailAlerts(loadMailAlerts().filter((a) => a.key !== key))
}

// Mark as read (in Gmail), Keep unread (only the card goes), or open it in Gmail in the
// browser (Gmail marks it read; the next check then removes the card).
export async function runMailAction(key: string, action: MailAction) {
  const alert = loadMailAlerts().find((a) => a.key === key)
  if (!alert) return
  if (action === 'mail-open') return openInGmail(alert)
  removeAlert(key) // right away; a failed "mark as read" just leaves it unread
  if (action === 'mail-read') {
    await gmailApi(alert.account, `messages/${alert.id}/modify`, {
      method: 'POST',
      body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
    })
  }
}

// The conversation in Gmail, signed in as the right account
function openInGmail(alert: MailAlert) {
  openLink(`https://mail.google.com/mail/?authuser=${encodeURIComponent(alert.account)}#all/${alert.threadId}`)
}
