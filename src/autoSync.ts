import { savePendingEdits } from './db'
import { waitForChanges } from './dropbox'
import { read, write } from './localState'
import { RetrySoonError, syncNow, type SyncResult } from './sync'

// Runs sync automatically and keeps track of its status for the cloud button.
// Syncs: when started (app open + unlocked), ~1.5 s after the user stops editing, when the
// window gets focus again, when the connection comes back, when the app goes to the
// background with changes waiting, and when Dropbox reports a change (longpoll).

export type SyncStatus = 'off' | 'synced' | 'syncing' | 'pending' | 'offline' | 'error'

const EDIT_DELAY_MS = 1000
const RETRY_SOON_MS = 3000
const RETRY_LATER_MS = 60_000
const FOCUS_MIN_GAP_MS = 5000 // no new sync on focus if the last one was this recent
const MAX_QUICK_RETRIES = 3

let status: SyncStatus = 'off'
// Same object until the status changes (React's useSyncExternalStore needs that)
// When the last sync finished without an error (shown on hover). Saved, so it's known after a restart.
let lastSuccessAt = read<number | null>('syncr.lastSyncedAt', null)
let snapshot: { status: SyncStatus; errorMessage: string | null; lastSuccessAt: number | null } = {
  status,
  errorMessage: null,
  lastSuccessAt,
}
const listeners = new Set<() => void>()

let enabled = false
let running = false
let changedDuringSync = false
let urgentAfterSync = false // syncSoon() was called during a sync: go again right away
let quickRetries = 0
let failing = false // the last sync ended with an error (already reported)
let lastSyncAt = 0
let timer: number | undefined
let cursor: string | null = null
let pollAbort: AbortController | null = null

// ---------- Status for the UI ----------

export function getStatus() {
  return snapshot
}

export function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function setStatus(next: SyncStatus, message: string | null = null) {
  status = next
  snapshot = { status: next, errorMessage: message, lastSuccessAt }
  listeners.forEach((listener) => listener())
}

// Short message under the cloud button (shown by SyncButton)
function notify(message: string) {
  window.dispatchEvent(new CustomEvent('sync-notice', { detail: message }))
}

// ---------- Running a sync ----------

function schedule(delay: number) {
  window.clearTimeout(timer)
  timer = window.setTimeout(() => run().catch(() => {}), delay)
}

// manual = the user clicked: problems are always reported. Automatic syncs report an error
// only the first time, not on every retry.
async function run(manual = false): Promise<SyncResult | undefined> {
  if (!enabled) return
  if (running) {
    changedDuringSync = true
    return
  }
  window.clearTimeout(timer)
  running = true
  changedDuringSync = false
  setStatus('syncing')
  try {
    const result = await syncNow()
    cursor = result.cursor
    lastSyncAt = Date.now()
    lastSuccessAt = lastSyncAt
    write('syncr.lastSyncedAt', lastSuccessAt)
    quickRetries = 0
    failing = false
    setStatus(changedDuringSync ? 'pending' : 'synced')
    if (!manual && result.conflicts) {
      notify(`${result.conflicts} conflict ${result.conflicts === 1 ? 'copy' : 'copies'} created.`)
    }
    poll()
    return result
  } catch (e) {
    const message =
      e instanceof DOMException && e.name === 'TimeoutError'
        ? 'Dropbox is not answering'
        : e instanceof Error
          ? e.message
          : String(e)
    if (e instanceof RetrySoonError && quickRetries < MAX_QUICK_RETRIES) {
      quickRetries++
      setStatus('pending')
      schedule(RETRY_SOON_MS)
    } else if (e instanceof TypeError || !navigator.onLine) {
      // fetch() throws TypeError when there's no connection
      if (manual) notify("You're offline. Changes will sync when you're back online.")
      setStatus('offline')
      schedule(RETRY_LATER_MS)
    } else {
      if (manual || !failing) notify(message)
      failing = true
      quickRetries = 0
      setStatus('error', message)
      schedule(RETRY_LATER_MS)
    }
  } finally {
    running = false
    if (changedDuringSync && enabled) syncAfter(urgentAfterSync ? 0 : EDIT_DELAY_MS)
    urgentAfterSync = false
  }
}

// Like schedule(), but when the app is in the background, starts right away: Android
// pauses timers in hidden apps, so a timer might only fire when the app is opened again.
function syncAfter(delay: number) {
  if (document.visibilityState === 'hidden' || delay === 0) {
    window.clearTimeout(timer)
    run().catch(() => {})
  } else {
    schedule(delay)
  }
}

// The user is done editing for now (left the editor or the app): sync waiting changes
// right away instead of after the usual delay.
export function syncSoon() {
  if (!enabled) return
  if (running) {
    if (changedDuringSync) urgentAfterSync = true
    return
  }
  if (status === 'pending') syncAfter(0)
}

// The user clicked the cloud. Returns undefined if it failed or a sync was already running.
export function syncByUser() {
  return run(true)
}

// ---------- Last sync before closing or updating ----------

const FINAL_SYNC_TIMEOUT_MS = 5000

// Saves waiting edits and sends everything that's waiting to Dropbox. Gives up after
// 5 seconds (e.g. offline): the changes stay safe on this device and sync next time.
export async function finalSync() {
  const work = async () => {
    await savePendingEdits()
    if (!enabled) return
    while (running) await sleep(50) // let a running sync finish first
    if (status !== 'synced') await run()
  }
  await Promise.race([work().catch(() => {}), sleep(FINAL_SYNC_TIMEOUT_MS)])
}

// ---------- Hearing about changes on the other device (longpoll) ----------

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

async function poll() {
  pollAbort?.abort()
  const abort = new AbortController()
  pollAbort = abort
  while (enabled && cursor && !abort.signal.aborted && document.visibilityState === 'visible') {
    try {
      const { changes, backoff } = await waitForChanges(cursor, abort.signal)
      if (abort.signal.aborted) return
      if (backoff) await sleep(backoff * 1000)
      if (changes) {
        // A successful sync starts a new poll. If one is running already, its poll will
        // report this change again, so nothing is lost.
        if (!running) await run().catch(() => {})
        return
      }
    } catch {
      if (abort.signal.aborted) return
      await sleep(30_000) // e.g. offline: try again later
    }
  }
}

// ---------- Events ----------

function onLocalChange() {
  if (!running) setStatus('pending')
  else changedDuringSync = true
  syncAfter(EDIT_DELAY_MS)
}

function onVisible() {
  if (document.visibilityState === 'hidden') {
    pollAbort?.abort()
    // Going to the background (back button, switching apps): send waiting changes now
    if (status === 'pending') syncAfter(0)
    return
  }
  onFocus()
}

function onFocus() {
  if (Date.now() - lastSyncAt > FOCUS_MIN_GAP_MS) schedule(0)
  else poll()
}

function onOnline() {
  schedule(0)
}

export function startAutoSync() {
  if (enabled) return
  enabled = true
  window.addEventListener('notes-changed', onLocalChange)
  window.addEventListener('focus', onFocus)
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisible)
  schedule(0)
}

export function stopAutoSync() {
  if (!enabled) return
  enabled = false
  window.removeEventListener('notes-changed', onLocalChange)
  window.removeEventListener('focus', onFocus)
  window.removeEventListener('online', onOnline)
  document.removeEventListener('visibilitychange', onVisible)
  window.clearTimeout(timer)
  pollAbort?.abort()
  cursor = null
  setStatus('off')
}
