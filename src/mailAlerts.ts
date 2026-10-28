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
// with "Keep unread" (the mail stays unread). A card opened to read the mail (MailReader.tsx)
// marks it read and stays until closed (Done, Mark as unread). A card that faded by itself
// (Settings → Alerts → Emails) leaves its mail unread and "missed", for the Mail tab.

export interface MailAlert {
  key: string // "mail:<account>:<message id>"
  account: string // the Gmail address
  id: string // Gmail's message id
  threadId: string
  from: string // the sender's name (or address)
  subject: string
  snippet: string // the start of the text, from Gmail
  date: number // ms since epoch
  opened?: boolean // opened to read (marked read): stays until closed
}

// mail-read: Mark as read · mail-close: the card goes, the mail stays as it is (Keep unread,
// Done after reading) · mail-open: in Gmail · mail-opened: opened to read (marks it read) ·
// mail-unread: Mark as unread (the card goes) · mail-fade: faded by itself (missed)
export type MailAction = 'mail-read' | 'mail-close' | 'mail-open' | 'mail-opened' | 'mail-unread' | 'mail-fade'

const ALERTS_KEY = 'syncr.gmail.alerts'
const SEEN_KEY = 'syncr.gmail.seen' // per account: message ids already known (never shown again)
const MISSED_KEY = 'syncr.gmail.missed' // keys of alerts that faded unread (until read anywhere)
const HISTORY_KEY = 'syncr.gmail.history' // per account: Gmail's history id at the last full check
const CHECKED_KEY = 'syncr.gmail.checked' // per account: when the unread list was last read (ms)
// A card only for mail that arrived since the last check (minus this): an older mail marked
// unread again in Gmail shows in the Mail tab only
const ARRIVAL_MARGIN_MS = 10 * 60_000
const CHECK_EVERY_MS = 60_000
export const QUERY = 'in:inbox is:unread category:primary'
const MAX_SEEN = 500 // per account; new mail always has a new id, so older ones can go
const MAX_NEW = 10 // cards added per check and account at most (e.g. after a long time off)

export const loadMailAlerts = () => read<MailAlert[]>(ALERTS_KEY, [])
export const loadMissed = () => read<string[]>(MISSED_KEY, [])

function saveMissed(keys: string[]) {
  if (JSON.stringify(keys) === JSON.stringify(loadMissed())) return
  write(MISSED_KEY, keys)
  window.dispatchEvent(new Event('mail-missed-change')) // this window; others get "storage"
}

// The missed emails' keys (Mail tab, its count in the sidebar), kept current
export function useMissed() {
  const [missed, setMissed] = useState(loadMissed)
  useEffect(() => {
    const refresh = () => setMissed(loadMissed())
    const onStorage = (e: StorageEvent) => e.key === MISSED_KEY && refresh()
    window.addEventListener('mail-missed-change', refresh)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('mail-missed-change', refresh)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  return missed
}

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

// A removed account: its cards, known ids and missed marks go from this device right away
export function forgetAccountMail(email: string) {
  const prefix = `mail:${email}:`
  saveMailAlerts(loadMailAlerts().filter((alert) => alert.account !== email))
  const seen = read<Record<string, string[]>>(SEEN_KEY, {})
  delete seen[email]
  write(SEEN_KEY, seen)
  const history = read<Record<string, string>>(HISTORY_KEY, {})
  delete history[email]
  write(HISTORY_KEY, history)
  const checked = read<Record<string, number>>(CHECKED_KEY, {})
  delete checked[email]
  write(CHECKED_KEY, checked)
  saveMissed(loadMissed().filter((key) => !key.startsWith(prefix)))
}

// ---------- Checking ----------

let checking = false
let again = false // asked while checking (e.g. instant mail's signal): one more check after
// Cards closed during this run of SyncR: a check that started before keeps them out
const closed = new Set<string>()

// Whether anything changed in the account's mailbox since the history id (new mail, mail read,
// moved…), and the id to remember now. Gmail's "history" costs less than listing the unread
// mail. Without an id, or one Gmail no longer knows (they last about a week): changed.
async function mailboxChange(email: string, since: string | undefined) {
  if (since) {
    try {
      const history = await gmailApi(email, `history?startHistoryId=${since}&maxResults=1`)
      return { changed: !!history.history?.length, historyId: history.historyId as string }
    } catch (error) {
      if ((error as { status?: number }).status !== 404) throw error
    }
  }
  // Taken before the list, so mail arriving in between shows as a change next time
  const profile = await gmailApi(email, 'profile')
  return { changed: true, historyId: profile.historyId as string }
}

// One check of all accounts: the unread list only for accounts whose mailbox changed. Errors
// (offline, Google down) leave that account as it was: the next check tries again.
export async function checkMail() {
  if (checking) {
    again = true
    return
  }
  checking = true
  try {
    const accounts = loadAccounts().filter((a) => a.enabled && !a.expired)
    const seen = read<Record<string, string[]>>(SEEN_KEY, {})
    const history = read<Record<string, string>>(HISTORY_KEY, {})
    const checked = read<Record<string, number>>(CHECKED_KEY, {})
    // Cards of accounts that were removed, turned off or signed out go
    let alerts = loadMailAlerts().filter((alert) => accounts.some((a) => a.email === alert.account))
    let missed = loadMissed().filter((key) => accounts.some((a) => key.startsWith(`mail:${a.email}:`)))
    let anyChange = false
    for (const { email } of accounts) {
      try {
        const { changed, historyId } = await mailboxChange(email, history[email])
        if (!changed) {
          history[email] = historyId
          continue
        }
        anyChange = true
        const startedAt = Date.now()
        const list = await gmailApi(email, `messages?q=${encodeURIComponent(QUERY)}&maxResults=50`)
        const unread: { id: string; threadId: string }[] = list?.messages ?? []
        const unreadIds = new Set(unread.map((m) => m.id))
        const known = seen[email]
        const fresh = known ? unread.filter((m) => !known.includes(m.id)).slice(0, MAX_NEW) : [] // first check: none
        const since = checked[email] ? checked[email] - ARRIVAL_MARGIN_MS : 0
        const added = (await Promise.all(fresh.map((m) => fetchAlert(email, m.id)))).filter((a) => a.date > since)
        alerts = [
          ...added,
          // Read since (anywhere): its card goes, unless it's open to read
          ...alerts.filter((alert) => alert.account !== email || alert.opened || unreadIds.has(alert.id)),
        ]
        missed = missed.filter((key) => !key.startsWith(`mail:${email}:`) || unreadIds.has(key.split(':')[2]))
        seen[email] = [...new Set([...unreadIds, ...(known ?? [])])].slice(0, MAX_SEEN)
        history[email] = historyId
        checked[email] = startedAt
      } catch (error) {
        console.error(error)
      }
    }
    for (const email of Object.keys(seen)) {
      if (!loadAccounts().some((a) => a.email === email)) delete seen[email] // removed account
    }
    for (const email of Object.keys(history)) {
      if (!loadAccounts().some((a) => a.email === email)) delete history[email]
    }
    for (const email of Object.keys(checked)) {
      if (!loadAccounts().some((a) => a.email === email)) delete checked[email]
    }
    write(SEEN_KEY, seen)
    write(HISTORY_KEY, history)
    write(CHECKED_KEY, checked)
    saveMissed(missed)
    alerts = alerts.filter((alert) => !closed.has(alert.key)).sort((a, b) => b.date - a.date)
    if (JSON.stringify(alerts) !== JSON.stringify(loadMailAlerts())) saveMailAlerts(alerts)
    if (anyChange) window.dispatchEvent(new Event('mailbox-change')) // the Mail tab reloads
  } finally {
    checking = false
    if (again) {
      again = false
      void checkMail()
    }
  }
}

// A card's content: sender, subject, start of the text (Gmail's "metadata": no body). Also
// the Mail tab's rows (mailbox.ts).
export async function fetchAlert(account: string, id: string): Promise<MailAlert> {
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

// Runs a card's button (MailAction). Open in Gmail: in the browser (Gmail marks it read; the
// next check then removes the card).
export async function runMailAction(key: string, action: MailAction) {
  const alert = loadMailAlerts().find((a) => a.key === key)
  if (!alert) return
  if (action === 'mail-open') return openInGmail(alert)
  if (action === 'mail-opened') {
    saveMailAlerts(loadMailAlerts().map((a) => (a.key === key ? { ...a, opened: true } : a)))
    return setUnread(alert, false)
  }
  removeAlert(key) // right away; if Gmail can't be reached, the mail just stays as it was
  if (action === 'mail-fade') saveMissed([...new Set([key, ...loadMissed()])])
  if (action === 'mail-read') await setUnread(alert, false)
  if (action === 'mail-unread') await setUnread(alert, true)
}

const setUnread = (alert: MailAlert, unread: boolean) => changeMail(alert.key, unread ? 'unread' : 'read')

// A change to a mail from the pop-up or the Mail tab (key: "mail:<account>:<id>"). Its card
// and its "missed" mark go (Keep unread: only the mark). Delete = Gmail's Trash (30 days).
export async function changeMail(key: string, change: 'read' | 'unread' | 'archive' | 'trash' | 'keep') {
  saveMissed(loadMissed().filter((k) => k !== key))
  if (change === 'keep') return
  if (loadMailAlerts().some((a) => a.key === key && !a.opened)) removeAlert(key)
  const [, account, id] = key.split(':')
  if (change === 'trash') return void (await gmailApi(account, `messages/${id}/trash`, { method: 'POST' }))
  const labels =
    change === 'read' ? { removeLabelIds: ['UNREAD'] }
    : change === 'unread' ? { addLabelIds: ['UNREAD'] }
    : { removeLabelIds: ['INBOX'] } // archive: out of the inbox, kept in All Mail
  await gmailApi(account, `messages/${id}/modify`, { method: 'POST', body: JSON.stringify(labels) })
}

// The conversation in Gmail, signed in as the right account
export const gmailLink = (mail: MailAlert) =>
  `https://mail.google.com/mail/?authuser=${encodeURIComponent(mail.account)}#all/${mail.threadId}`

const openInGmail = (alert: MailAlert) => openLink(gmailLink(alert))

// ---------- Reading ----------

export interface MailBody {
  html: string // the mail as HTML (a plain-text mail: escaped, links made clickable)
  plain: boolean // it was plain text (shown in the app's colors; HTML mails on white)
  remoteImages: boolean // it loads images from the web (blocked until "Show images")
}

interface Part {
  mimeType?: string
  filename?: string
  headers?: { name: string; value: string }[]
  body?: { data?: string; attachmentId?: string }
  parts?: Part[]
}

// The mail's text, read in the pop-up (MailReader.tsx): its HTML part, else its plain text
export async function fetchMailBody(alert: MailAlert): Promise<MailBody> {
  const message = await gmailApi(alert.account, `messages/${alert.id}?format=full`)
  const part = findPart(message.payload, 'text/html') ?? findPart(message.payload, 'text/plain')
  if (!part) return { html: '<p><i>This email has no text.</i></p>', plain: true, remoteImages: false }
  let data = part.body?.data
  if (!data && part.body?.attachmentId) {
    // A long text comes apart from the message, like an attachment
    data = (await gmailApi(alert.account, `messages/${alert.id}/attachments/${part.body.attachmentId}`)).data
  }
  const charset = /charset="?([^";\s]+)/i.exec(
    part.headers?.find((h) => h.name.toLowerCase() === 'content-type')?.value ?? '',
  )?.[1]
  const text = decodePart(data ?? '', charset)
  if (part.mimeType === 'text/html') {
    return { html: text, plain: false, remoteImages: REMOTE_IMAGE.test(text) }
  }
  return { html: `<pre>${linkify(escapeHtml(text))}</pre>`, plain: true, remoteImages: false }
}

// The first part of this type that isn't an attached file (mails nest parts: alternatives,
// related images, attachments)
function findPart(part: Part | undefined, type: string): Part | undefined {
  if (!part) return undefined
  if (part.mimeType === type && !part.filename) return part
  for (const child of part.parts ?? []) {
    const found = findPart(child, type)
    if (found) return found
  }
  return undefined
}

// Gmail gives each part as base64url bytes, in the mail's own character set
function decodePart(data: string, charset = 'utf-8') {
  const bytes = Uint8Array.from(atob(data.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    return new TextDecoder().decode(bytes) // a character set the browser doesn't know
  }
}

// An image from the web: <img src="https://…">, a CSS url(https://…), background="https://…"
const REMOTE_IMAGE = /<img[^>]+src\s*=\s*["']?https?:|url\(\s*["']?https?:|background\s*=\s*["']?https?:/i

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Web addresses in a plain-text mail become links (after escaping, so no other HTML)
const linkify = (html: string) =>
  html.replace(/https?:\/\/(?:(?!&gt;|&quot;)[^\s<])+/g, (match) => {
    const url = match.replace(/[.,;:!?)\]']+$/, '') // a sentence's end isn't part of it
    return `<a href="${url}">${url}</a>${match.slice(url.length)}`
  })
