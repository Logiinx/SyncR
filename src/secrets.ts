import { invoke, isTauri } from '@tauri-apps/api/core'
import { fromBase64, toBase64 } from './crypto'

// Secrets kept per device in localStorage (sign-in keys, …). On the PC they're stored
// encrypted with Windows DPAPI (lib.rs, dpapi): only this Windows user can read them.
// They're decrypted once at start (loadSecrets, before the app needs them) and kept in
// memory, so reading them stays instant; saving one stores it encrypted again.
// On the phone and in a browser: plain localStorage as before (no DPAPI there).

const MARK = 'dpapi:' // a stored value = MARK + base64 of the encrypted bytes
const memory = new Map<string, string | null>()
let writes = Promise.resolve() // one after the other, so an older value can't land after a newer one

async function decrypt(stored: string | null) {
  if (stored === null || !stored.startsWith(MARK)) return stored // not encrypted (yet)
  try {
    const data = Array.from(fromBase64(stored.slice(MARK.length)))
    return await invoke<string>('unprotect_secret', { data })
  } catch (error) {
    // E.g. copied from another Windows user: then it's as if signed out (the stored value stays)
    console.error('Secret could not be decrypted', error)
    return null
  }
}

// At start, before the secrets are read. Only these keys are kept in memory.
export async function loadSecrets(keys: string[]) {
  if (!isTauri()) return
  await Promise.all(keys.map(async (key) => memory.set(key, await decrypt(localStorage.getItem(key)))))
  // Another SyncR window (the reminder pop-up) saved one: take it over, then tell this window
  window.addEventListener('storage', async (event) => {
    if (event.key === null || !memory.has(event.key)) return
    memory.set(event.key, await decrypt(event.newValue))
    window.dispatchEvent(new CustomEvent('secret-change', { detail: event.key }))
  })
}

export function getSecret(key: string): string | null {
  if (!isTauri()) return localStorage.getItem(key)
  return memory.get(key) ?? null
}

// null removes it. Readable at once; on the PC it's on disk once the returned promise is done.
export function setSecret(key: string, value: string | null): Promise<void> {
  if (!isTauri()) {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
    return Promise.resolve()
  }
  memory.set(key, value)
  writes = writes.then(async () => {
    if (value === null) return localStorage.removeItem(key)
    const data = await invoke<number[]>('protect_secret', { text: value })
    localStorage.setItem(key, MARK + toBase64(Uint8Array.from(data)))
  }).catch((error) => console.error('Secret could not be saved', error))
  return writes
}
