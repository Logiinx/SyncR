import { invoke, isTauri } from '@tauri-apps/api/core'
import { fromBase64, toBase64 } from './crypto'
import { openBytes, sealBytes } from './sealing'

// Secrets kept per device in localStorage: the sign-ins (with their keys) of Dropbox, Google
// Calendar and Gmail, and on the PC the sync key (crypto.ts) and the local database's key
// (localDb.ts). On the PC they're stored encrypted with Windows DPAPI (lib.rs, dpapi): only this
// Windows user can read them. They're decrypted once at start (loadSecrets, before the app shows) and kept in memory, so reading
// them stays instant; saving one stores it encrypted again. On the phone and in a browser:
// plain localStorage (no DPAPI there).
// The PKCE "verifiers" stay plain: they only live for one sign-in and are useless alone.
// With the PIN lock on (pinLock.ts), the sign-ins and the sync key are also encrypted with the
// local database's key before Windows encrypts them, so they can't be read until SyncR is unlocked.

export const DROPBOX_SECRET = 'syncr.dropbox'
export const GOOGLE_SECRET = 'syncr.google'
export const GMAIL_SECRET = 'syncr.gmail'
export const SYNC_KEY_SECRET = 'syncr.sync-key'
export const LOCAL_KEY_SECRET = 'syncr.local-key' // PC only: the key of the sealed local database (localDb.ts)
const KEYS = [DROPBOX_SECRET, GOOGLE_SECRET, GMAIL_SECRET, SYNC_KEY_SECRET, LOCAL_KEY_SECRET]

const PIN_KEYS = [DROPBOX_SECRET, GOOGLE_SECRET, GMAIL_SECRET, SYNC_KEY_SECRET]

const MARK = 'dpapi:' // a stored value = MARK + base64 of the encrypted bytes
const PIN_MARK = 'pin:' // inside: PIN_MARK + base64 of sealBytes() (sealing.ts)
const memory = new Map<string, string | null>()
const waiting = new Map<string, string>() // behind the PIN lock, opened once unlocked (openWaitingSecrets)
const pinned = new Set<string>() // stored behind the PIN lock
let writes = Promise.resolve() // one after the other, so an older value can't land after a newer one
const saving = new Map<string, number>() // per key: this window's saves not on disk yet

// With the PIN lock on, LOCAL_KEY_SECRET holds its lockboxes (JSON, pinLock.ts) instead of the key
export const pinLockOn = () => getSecret(LOCAL_KEY_SECRET)?.startsWith('{') ?? false

async function decrypt(key: string, stored: string | null) {
  if (stored === null || !stored.startsWith(MARK)) return stored // not encrypted (yet)
  try {
    const data = Array.from(fromBase64(stored.slice(MARK.length)))
    const text = await invoke<string>('unprotect_secret', { data })
    if (!text.startsWith(PIN_MARK)) {
      pinned.delete(key)
      return text
    }
    pinned.add(key)
    waiting.set(key, text)
    return openWaiting(key) // null while locked
  } catch (error) {
    // E.g. copied from another Windows user: then it's as if signed out (the stored value stays)
    console.error('Secret could not be decrypted', error)
    return null
  }
}

// At start, before anything reads a secret (main.tsx). Secrets stored plain by an older
// version get encrypted here.
export async function loadSecrets() {
  // Another SyncR window (the reminder pop-up, another browser tab) saved one: take it over,
  // then tell this window ("secret-change", the key in detail)
  window.addEventListener('storage', async (event) => {
    if (event.key === null || !KEYS.includes(event.key)) return
    if (isTauri()) {
      const value = await decrypt(event.key, event.newValue)
      // Decrypting takes a moment: a newer save may have come meanwhile, and its event (which
      // may finish first) has the say. Only the value still stored is taken, and not while
      // this window is saving its own (newer: it lands after, the other window takes it then).
      if (localStorage.getItem(event.key) !== event.newValue || saving.get(event.key)) return
      memory.set(event.key, value)
    }
    window.dispatchEvent(new CustomEvent('secret-change', { detail: event.key }))
  })
  if (!isTauri()) return
  await Promise.all(
    KEYS.map(async (key) => {
      const stored = localStorage.getItem(key)
      const value = await decrypt(key, stored)
      memory.set(key, value)
      if (value !== null && value === stored) void setSecret(key, value) // still plain
    }),
  )
}

function openWaiting(key: string): string | null {
  const text = waiting.get(key)
  if (text === undefined) return memory.get(key) ?? null
  let value: string | null = null
  try {
    value = new TextDecoder().decode(openBytes(fromBase64(text.slice(PIN_MARK.length))))
  } catch (error) {
    if (error instanceof Error && error.message === 'The local key is missing') return null // locked: stays waiting
    console.error('Secret could not be opened', error) // as if signed out
  }
  waiting.delete(key)
  return value
}

// Once unlocked (localDb.ts): the secrets that waited for the key. Then each is saved again
// if it's stored the other way (e.g. the PIN lock was turned off or on and SyncR closed midway).
export function openWaitingSecrets() {
  for (const key of [...waiting.keys()]) memory.set(key, openWaiting(key))
  return saveSignInsAgain()
}

// After the PIN lock was turned on or off: each sign-in stored the current way. false if one
// didn't get to the disk (it's tried again after the next unlock).
export async function saveSignInsAgain() {
  const on = pinLockOn()
  const saves = PIN_KEYS.filter((key) => getSecret(key) !== null && pinned.has(key) !== on).map((key) => setSecret(key, getSecret(key)))
  return (await Promise.all(saves)).every(Boolean)
}

export function getSecret(key: string): string | null {
  if (!isTauri()) return localStorage.getItem(key)
  return memory.get(key) ?? null
}

// null removes it. Readable at once; on the PC it's on disk once the returned promise is done.
// The promise says whether it got there: false = only in memory, gone at the next start.
export function setSecret(key: string, value: string | null): Promise<boolean> {
  if (!isTauri()) {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
    return Promise.resolve(true)
  }
  memory.set(key, value)
  waiting.delete(key)
  let text = value
  try {
    if (value !== null && PIN_KEYS.includes(key) && pinLockOn()) text = PIN_MARK + toBase64(sealBytes(new TextEncoder().encode(value)))
  } catch (error) {
    console.error('Secret could not be saved', error) // locked: nothing should save then
    return Promise.resolve(false)
  }
  if (PIN_KEYS.includes(key)) {
    if (text?.startsWith(PIN_MARK)) pinned.add(key)
    else pinned.delete(key)
  }
  saving.set(key, (saving.get(key) ?? 0) + 1)
  const saved = writes.then(async () => {
    if (text === null) localStorage.removeItem(key)
    else {
      const data = await invoke<number[]>('protect_secret', { text })
      localStorage.setItem(key, MARK + toBase64(Uint8Array.from(data)))
    }
    return true
  }).catch((error) => {
    console.error('Secret could not be saved', error)
    return false
  }).finally(() => saving.set(key, saving.get(key)! - 1))
  writes = saved.then(() => undefined)
  return saved
}
