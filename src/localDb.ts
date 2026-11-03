import Dexie, { type Table } from 'dexie'
import { isTauri } from '@tauri-apps/api/core'
import { db, defineSchema, LOCAL_DB_FLAG, sealedDb } from './db'
import { previewKey, readyBlob, sealingLayer, setSealKey } from './sealing'
import { getSecret, LOCAL_KEY_SECRET, setSecret } from './secrets'
import { encrypt, fromBase64, getKey, toBase64 } from './crypto'

// At the start on the PC, before the app shows (main.tsx): the key of the sealed local
// database (sealing.ts), kept like the sign-ins (secrets.ts: protected by Windows), and the
// one-time move of the old plain database into the sealed one. Phone and browser: nothing.
// The move: everything is copied into a new database ("syncr-local") through the sealing
// layer and checked, then the old one is deleted, so no readable copy stays in its files.
// Before that, a backup of the old one is kept for 14 days ("syncr-backup"), encrypted with
// the sync key (it opens with the passphrase even if the new key breaks). No button restores it:
// if ever needed, a fix release does (the backup's layout is below, keep it simple).

const OLD_NAME = 'syncr'
const NEW_NAME = 'syncr-local'
const BACKUP_NAME = 'syncr-backup'
const BACKUP_DAYS = 14

// 'moved': the page must reload to open the new database. 'key-missing': the database is
// sealed but Windows didn't give back its key (KeyMissing.tsx).
export type LocalDbState = 'ready' | 'moved' | 'key-missing'

export async function prepareLocalDb(isPopup: boolean): Promise<LocalDbState> {
  if (!isTauri()) return 'ready'
  if (sealedDb) {
    const stored = getSecret(LOCAL_KEY_SECRET)
    if (!stored) return 'key-missing'
    setSealKey(fromBase64(stored))
    if (!isPopup) cleanUp().catch((error) => console.error('Local database clean-up failed', error))
    return 'ready'
  }
  if (isPopup) return 'ready' // the main window moves it
  try {
    let stored = getSecret(LOCAL_KEY_SECRET)
    if (!stored) {
      stored = toBase64(crypto.getRandomValues(new Uint8Array(32)))
      if (!(await setSecret(LOCAL_KEY_SECRET, stored))) throw new Error("Windows couldn't store the key")
    }
    await move(fromBase64(stored))
    return 'moved'
  } catch (error) {
    // Stays plain for now, tried again at the next start
    console.error('Local database not encrypted', error)
    await db.open().catch(() => {})
    setTimeout(() => notice("Your notes on this PC couldn't be encrypted yet: SyncR tries again at the next start."), 5000)
    return 'ready'
  }
}

function notice(message: string) {
  window.dispatchEvent(new CustomEvent('sync-notice', { detail: message })) // SyncButton
}

async function move(key: Uint8Array) {
  db.close() // nothing may write to the old database during the move
  await Dexie.delete(NEW_NAME) // a move cut short before
  if (await Dexie.exists(OLD_NAME)) {
    const old = new Dexie(OLD_NAME)
    defineSchema(old)
    const rows: Record<string, Record<string, unknown>[]> = {}
    for (const table of old.tables) rows[table.name] = await table.toArray()
    old.close()
    await writeBackup(rows, key)

    setSealKey(key)
    for (const row of rows.attachments) await readyBlob(row.blob as Blob)
    for (const row of rows.linkPreviews) row.url = await previewKey(row.url as string)
    const next = new Dexie(NEW_NAME)
    defineSchema(next)
    next.use(sealingLayer)
    await next.transaction('rw', next.tables, async () => {
      for (const table of next.tables) await table.bulkPut(rows[table.name])
    })
    // Read everything back (opened again) and compare, before the old one goes
    for (const table of next.tables) {
      const back = await table.toArray()
      const expected = new Set(rows[table.name].map(canonical))
      if (back.length !== expected.size || back.some((row) => !expected.has(canonical(row)))) {
        throw new Error(`Moved ${table.name} differs`)
      }
    }
    next.close()
  }
  localStorage.setItem(LOCAL_DB_FLAG, 'sealed')
  // Done: from here the new database counts. A failed delete is retried at the next start (cleanUp).
  await Dexie.delete(OLD_NAME).catch((error) => console.error('Old database not deleted yet', error))
}

// A row as text, the same whatever the order of its fields (images: their type and size)
function canonical(row: unknown) {
  return JSON.stringify(row, (_, value) => {
    if (value instanceof Blob) return `image ${value.type} ${value.size}`
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))
    }
    return value
  })
}

// ---------- Backup ----------
// One row { id: 'move', createdAt, lockedWith, data } in the database "syncr-backup".
// data = encrypt() of crypto.ts (12 bytes IV + AES-GCM) of the JSON
// { version: 1, createdAt, tables: { <table>: rows } }, where an image field is
// { $image: <type>, base64: <bytes> }. lockedWith 'sync' = the sync key (passphrase);
// 'local' = the new local key (only when this PC had no sync key).
// The keys table isn't in it (the PC's sync key is kept elsewhere, see crypto.ts).

interface BackupRow {
  id: 'move'
  createdAt: number
  lockedWith: 'sync' | 'local'
  data: Uint8Array
}

function backupDb() {
  const backup = new Dexie(BACKUP_NAME) as Dexie & { backups: Table<BackupRow, string> }
  backup.version(1).stores({ backups: 'id' })
  return backup
}

async function writeBackup(rows: Record<string, Record<string, unknown>[]>, localKey: Uint8Array) {
  const tables: Record<string, unknown[]> = {}
  for (const [name, list] of Object.entries(rows)) {
    if (name === 'keys') continue
    tables[name] = await Promise.all(
      list.map(async (row) => {
        const out: Record<string, unknown> = { ...row }
        for (const [field, value] of Object.entries(row)) {
          if (value instanceof Blob) out[field] = { $image: value.type, base64: bigBase64(new Uint8Array(await value.arrayBuffer())) }
        }
        return out
      }),
    )
  }
  const createdAt = Date.now()
  const json = new TextEncoder().encode(JSON.stringify({ version: 1, createdAt, tables }))
  const syncKey = await getKey()
  const key = syncKey ?? (await crypto.subtle.importKey('raw', localKey as Uint8Array<ArrayBuffer>, 'AES-GCM', false, ['encrypt']))
  const data = await encrypt(key, json)
  const backup = backupDb()
  await backup.backups.put({ id: 'move', createdAt, lockedWith: syncKey ? 'sync' : 'local', data })
  backup.close()
}

// toBase64 (crypto.ts) is for small things: big images would overflow it
function bigBase64(bytes: Uint8Array) {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

// The old database left by a move cut short after it was sealed, and the backup once it's old
async function cleanUp() {
  if (await Dexie.exists(OLD_NAME)) await Dexie.delete(OLD_NAME)
  if (!(await Dexie.exists(BACKUP_NAME))) return
  const backup = backupDb()
  const row = await backup.backups.get('move')
  backup.close()
  if (!row || Date.now() - row.createdAt > BACKUP_DAYS * 24 * 60 * 60 * 1000) await Dexie.delete(BACKUP_NAME)
}

// "Start fresh" (KeyMissing.tsx): the sealed database can't be opened anymore. It's deleted and
// a new one made at the next start; sync then downloads everything again.
export async function startFresh() {
  db.close()
  await Dexie.delete(NEW_NAME)
  localStorage.removeItem(LOCAL_DB_FLAG)
  await setSecret(LOCAL_KEY_SECRET, null)
}
