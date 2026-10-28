import { useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { gmailApi, googleApi, loadAccounts } from './gmail'
import { read, write } from './localState'
import { checkMail } from './mailAlerts'

// Instant mail (PC): Gmail sends a signal to a Google Cloud Pub/Sub queue (topic TOPIC in the
// user's own project) whenever an inbox changes ("watch", per account, renewed daily: it ends
// after 7 days). SyncR's main window collects the signals (SUBSCRIPTION) with the one Gmail
// account signed in with the Pub/Sub permission (the project's owner), and checks the mail
// right away. No server of SyncR's own, no open connection: it asks the queue again and again.
// The minute check (mailAlerts.ts) carries on as a safety net. Set up: Settings → Gmail.

const TOPIC = 'syncr-gmail'
const SUBSCRIPTION = 'syncr-gmail-sub' // the topic's default subscription
const SETTING_KEY = 'syncr.gmail.instant' // per PC: the project ID
const WATCHED_KEY = 'syncr.gmail.watched' // per account: when its watch was renewed, for which project
const RENEW_MS = 24 * 3600_000
const PULL_TIMEOUT_MS = 120_000 // Pub/Sub may wait a while for a signal before answering
const SHORT_PULL_MS = 5_000 // an empty answer faster than this: wait a moment before asking again
const RETRY_MS = 60_000 // after an error (offline, setup not finished)

export const loadProjectId = () => read<{ projectId: string }>(SETTING_KEY, { projectId: '' }).projectId

export function saveProjectId(projectId: string) {
  write(SETTING_KEY, { projectId })
  window.dispatchEvent(new Event('instant-mail-change'))
}

// ---------- Status (Settings → Gmail) ----------

export type InstantStatus = { ok: boolean; text: string }
let status: InstantStatus = { ok: false, text: '' }

function setStatus(next: InstantStatus) {
  if (next.ok === status.ok && next.text === status.text) return
  status = next
  window.dispatchEvent(new Event('instant-mail-status'))
}

export function useInstantStatus() {
  const [current, setCurrent] = useState(status)
  useEffect(() => {
    const refresh = () => setCurrent(status)
    window.addEventListener('instant-mail-status', refresh)
    return () => window.removeEventListener('instant-mail-status', refresh)
  }, [])
  return current
}

// ---------- Watch ----------

// Renews the watch of each account that's on, once a day (or when the project changed)
async function renewWatches(projectId: string) {
  const watched = read<Record<string, { at: number; project: string }>>(WATCHED_KEY, {})
  const accounts = loadAccounts().filter((a) => a.enabled && !a.expired)
  for (const { email } of accounts) {
    const last = watched[email]
    if (last && last.project === projectId && Date.now() - last.at < RENEW_MS) continue
    await gmailApi(email, 'watch', {
      method: 'POST',
      body: JSON.stringify({ topicName: `projects/${projectId}/topics/${TOPIC}`, labelIds: ['INBOX'] }),
    })
    watched[email] = { at: Date.now(), project: projectId }
  }
  for (const email of Object.keys(watched)) {
    if (!accounts.some((a) => a.email === email)) delete watched[email] // off or removed: renewed when back
  }
  write(WATCHED_KEY, watched)
}

// ---------- Collecting the signals ----------

let wake: (() => void) | null = null // ends the current wait early (settings changed)

function pause(ms: number) {
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(done, ms)
    function done() {
      window.clearTimeout(timer)
      wake = null
      resolve()
    }
    wake = done
  })
}

// One round: renew the watches if due, ask the queue, check the mail if a signal came.
// Returns how long to wait before the next round.
async function round(): Promise<number> {
  const projectId = loadProjectId()
  const collector = loadAccounts().find((a) => a.pubsub && !a.expired)
  if (!projectId) {
    setStatus({ ok: false, text: 'Instant mail: off (no project ID) · checking every minute' })
    return RETRY_MS
  }
  if (!collector) {
    setStatus({ ok: false, text: 'Instant mail: needs a sign-in with the Pub/Sub permission (button above)' })
    return RETRY_MS
  }
  await renewWatches(projectId)
  const subscription = `https://pubsub.googleapis.com/v1/projects/${projectId}/subscriptions/${SUBSCRIPTION}`
  const startedAt = Date.now()
  const answer = await googleApi(
    collector.email,
    `${subscription}:pull`,
    { method: 'POST', body: JSON.stringify({ maxMessages: 20 }) },
    { name: 'Pub/Sub pull', timeoutMs: PULL_TIMEOUT_MS },
  )
  setStatus({ ok: true, text: `Instant mail: on (via ${collector.email})` })
  const ackIds: string[] = (answer?.receivedMessages ?? []).map((m: { ackId: string }) => m.ackId)
  if (ackIds.length > 0) {
    // Which account changed doesn't matter: the check asks every account what changed (cheap)
    await checkMail()
    await googleApi(
      collector.email,
      `${subscription}:acknowledge`,
      { method: 'POST', body: JSON.stringify({ ackIds }) },
      { name: 'Pub/Sub acknowledge' },
    )
    return 0
  }
  return Date.now() - startedAt < SHORT_PULL_MS ? SHORT_PULL_MS : 0
}

// Collects until the returned function stops it
export function startInstantMail() {
  let running = true
  // A change (project ID typed, account added or turned on): try again soon, once typing stops
  let restartTimer = 0
  const restart = () => {
    window.clearTimeout(restartTimer)
    restartTimer = window.setTimeout(() => wake?.(), 1500)
  }
  window.addEventListener('instant-mail-change', restart)
  window.addEventListener('gmail-change', restart)
  ;(async () => {
    while (running) {
      let wait: number
      try {
        wait = await round()
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        setStatus({ ok: false, text: `Instant mail: not working (${reason}) · checking every minute` })
        wait = RETRY_MS
      }
      if (running && wait > 0) await pause(wait)
    }
  })()
  return () => {
    running = false
    window.clearTimeout(restartTimer)
    wake?.()
    window.removeEventListener('instant-mail-change', restart)
    window.removeEventListener('gmail-change', restart)
  }
}

// Runs while the main window is open (PC only: two collectors would take each other's
// signals, so not in the browser, even while developing)
export function useInstantMail() {
  useEffect(() => (isTauri() ? startInstantMail() : undefined), [])
}
