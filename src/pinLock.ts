import { scryptAsync } from '@noble/hashes/scrypt.js'
import { decrypt, encrypt, fromBase64, getKey, passphraseKey, passphraseSettings, toBase64 } from './crypto'
import { getSecret, LOCAL_KEY_SECRET, pinLockOn, saveSignInsAgain, setSecret } from './secrets'
import { currentSealKey } from './sealing'

// The PIN lock (PC only, a Settings option, off by default). Off: the local database's key
// (localDb.ts) is kept as it is, encrypted by Windows. On: it's kept in two lockboxes instead
// (still encrypted by Windows on top), one opened by the PIN, one by the sync passphrase (a
// forgotten PIN, or MAX_TRIES wrong ones: the notes open at once, nothing downloaded again).
// Until one is opened, SyncR shows only the lock screen: nothing reads notes, syncs or alerts.
// The sign-ins and the sync key are behind the same key (secrets.ts).
// A lockbox = the local key encrypted (crypto.ts encrypt: AES-GCM) with a key made from the
// PIN or passphrase. PIN: scrypt, a slow key that needs a lot of memory, so graphics cards
// guess slowly (~0.5 s per try here). Passphrase: the sync key itself (its salt and setting
// copied from Dropbox's crypto.json, so it opens offline).
// The wrong tries are counted in localStorage: only to send someone at the PC to the
// passphrase; a copy of the files ignores any count (the slow key is what protects it).

export const MIN_PIN_LENGTH = 6
export const MAX_TRIES = 5
const TRIES = 'syncr.pin-tries'
const SCRYPT = { N: 2 ** 17, r: 8, p: 1 } // 128 MB

interface PinBox { salt: string; N: number; r: number; p: number; box: string }
interface PassBox { salt: string; iterations: number; box: string }
interface Lock { version: 1; pin: PinBox; pass: PassBox }

function readLock(): Lock | null {
  return pinLockOn() ? JSON.parse(getSecret(LOCAL_KEY_SECRET)!) : null
}

export const wrongTries = () => Number(localStorage.getItem(TRIES)) || 0

async function pinKey(pin: string, salt: string, settings: typeof SCRYPT) {
  const bytes = await scryptAsync(pin, fromBase64(salt), { ...settings, dkLen: 32 })
  return crypto.subtle.importKey('raw', bytes as Uint8Array<ArrayBuffer>, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function makePinBox(pin: string, localKey: Uint8Array): Promise<PinBox> {
  if (pin.length < MIN_PIN_LENGTH) throw new Error(`Use at least ${MIN_PIN_LENGTH} characters`)
  const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)))
  const box = await encrypt(await pinKey(pin, salt, SCRYPT), localKey as Uint8Array<ArrayBuffer>)
  return { salt, ...SCRYPT, box: toBase64(box) }
}

// The local key, or null if the PIN / passphrase is wrong
async function openBox(key: CryptoKey, box: string) {
  try {
    return await decrypt(key, fromBase64(box))
  } catch {
    return null
  }
}

const openPinBox = (lock: Lock, pin: string) =>
  pinKey(pin, lock.pin.salt, lock.pin).then((key) => openBox(key, lock.pin.box))

// ---------- Unlocking (lock screen) ----------

// The local key, or null (wrong PIN, counted; or too many wrong tries: passphrase only)
export async function unlockWithPin(pin: string) {
  const lock = readLock()
  if (!lock || wrongTries() >= MAX_TRIES) return null
  const localKey = await openPinBox(lock, pin)
  if (localKey) localStorage.removeItem(TRIES)
  else localStorage.setItem(TRIES, String(wrongTries() + 1))
  return localKey
}

// The local key, or null if the passphrase is wrong. A new PIN is chosen next (changePin).
export async function unlockWithPassphrase(passphrase: string) {
  const lock = readLock()
  if (!lock) return null
  const localKey = await openBox(await passphraseKey(passphrase, lock.pass.salt, lock.pass.iterations), lock.pass.box)
  if (localKey) localStorage.removeItem(TRIES)
  return localKey
}

// ---------- Settings ----------

// Throws with a message to show. Needs sync set up (the passphrase lockbox) and Dropbox reachable.
export async function turnPinOn(pin: string) {
  const stored = getSecret(LOCAL_KEY_SECRET)
  if (!stored || pinLockOn()) throw new Error('The PIN lock is already on')
  const passphrase = await passphraseSettings()
  const syncKey = await getKey()
  if (!passphrase || !syncKey) throw new Error("Sync isn't set up, or Dropbox can't be reached right now")
  const localKey = fromBase64(stored)
  const lock: Lock = {
    version: 1,
    pin: await makePinBox(pin, localKey),
    pass: { ...passphrase, box: toBase64(await encrypt(syncKey, localKey as Uint8Array<ArrayBuffer>)) },
  }
  await saveLock(JSON.stringify(lock), stored)
  localStorage.removeItem(TRIES)
}

// While unlocked (also right after the passphrase opened it)
export async function changePin(pin: string) {
  const lock = readLock()
  const localKey = currentSealKey()
  if (!lock || !localKey) throw new Error('The PIN lock is off')
  await saveLock(JSON.stringify({ ...lock, pin: await makePinBox(pin, localKey) }), getSecret(LOCAL_KEY_SECRET)!)
  localStorage.removeItem(TRIES)
}

// Not counted as a wrong try: SyncR is already unlocked (Settings asks it to turn the lock off)
export async function checkPin(pin: string) {
  const lock = readLock()
  return lock !== null && (await openPinBox(lock, pin)) !== null
}

export async function turnPinOff() {
  const localKey = currentSealKey()
  if (!pinLockOn() || !localKey) throw new Error('The PIN lock is off')
  await saveLock(toBase64(localKey), getSecret(LOCAL_KEY_SECRET)!)
  localStorage.removeItem(TRIES)
}

// The key or its lockboxes, then the sign-ins the new way. If Windows didn't store the first,
// everything stays as before. If a sign-in didn't get saved, it's done after the next unlock.
async function saveLock(value: string, before: string) {
  if (!(await setSecret(LOCAL_KEY_SECRET, value))) {
    await setSecret(LOCAL_KEY_SECRET, before)
    throw new Error("Windows couldn't store it, nothing changed")
  }
  await saveSignInsAgain()
}
