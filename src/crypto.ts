import { db } from './db'
import { download, upload } from './dropbox'

// End-to-end encryption for everything stored in Dropbox.
// AES-256-GCM, key derived from the passphrase with PBKDF2-SHA256.
// Each device remembers the key (non-exportable, in IndexedDB). The passphrase is never stored.

const CRYPTO_FILE = '/crypto.json'
const ITERATIONS = 600_000
const CHECK_TEXT = 'SyncR passphrase check'

// Stored in Dropbox, not secret. "check" is CHECK_TEXT encrypted, to detect a wrong passphrase.
interface CryptoFile {
  version: 1
  salt: string // base64
  iterations: number
  check: string // base64 of iv + ciphertext
}

export const MIN_PASSPHRASE_LENGTH = 8

// ---------- Helpers ----------

function toBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
}

function fromBase64(text: string) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false, // non-exportable: the key can be used but never read out
    ['encrypt', 'decrypt'],
  )
}

// Result: 12-byte random IV followed by the ciphertext.
export async function encrypt(key: CryptoKey, data: Uint8Array<ArrayBuffer>) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data))
  const out = new Uint8Array(iv.length + ciphertext.length)
  out.set(iv)
  out.set(ciphertext, iv.length)
  return out
}

// Throws if the key is wrong or the data was changed.
export async function decrypt(key: CryptoKey, data: Uint8Array) {
  const iv = data.slice(0, 12)
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data.slice(12)))
}

// ---------- The key remembered on this device ----------

export async function getKey(): Promise<CryptoKey | undefined> {
  return (await db.keys.get('sync'))?.key
}

async function saveKey(key: CryptoKey | null) {
  if (key) await db.keys.put({ name: 'sync', key })
  else await db.keys.delete('sync')
  window.dispatchEvent(new Event('sync-key-change'))
}

export function forgetKey() {
  return saveKey(null)
}

// ---------- Create / unlock ----------

// true if a passphrase was already created (on any device).
export async function hasPassphrase() {
  return (await download(CRYPTO_FILE)) !== null
}

export async function createPassphrase(passphrase: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveKey(passphrase, salt, ITERATIONS)
  const check = await encrypt(key, new TextEncoder().encode(CHECK_TEXT))
  const file: CryptoFile = { version: 1, salt: toBase64(salt), iterations: ITERATIONS, check: toBase64(check) }
  // "add" fails instead of overwriting, in case another device created one just now
  const created = await upload(CRYPTO_FILE, new TextEncoder().encode(JSON.stringify(file)), 'add')
  if (!created) throw new Error('A passphrase was just created on another device. Close this and enter that one.')
  await saveKey(key)
}

// Returns false if the passphrase is wrong.
export async function unlock(passphrase: string) {
  const raw = await download(CRYPTO_FILE)
  if (!raw) throw new Error('No passphrase found in Dropbox.')
  const file: CryptoFile = JSON.parse(new TextDecoder().decode(raw))
  const key = await deriveKey(passphrase, fromBase64(file.salt), file.iterations)
  try {
    const text = new TextDecoder().decode(await decrypt(key, fromBase64(file.check)))
    if (text !== CHECK_TEXT) return false
  } catch {
    return false
  }
  await saveKey(key)
  return true
}
