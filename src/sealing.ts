import { gcm } from '@noble/ciphers/aes.js'
import { t } from './i18n'
import type { DBCore, DBCoreGetManyRequest, DBCoreGetRequest, DBCoreMutateRequest, DBCoreOpenCursorRequest, DBCoreQueryRequest, DBCoreTable, Middleware } from 'dexie'

// On the PC, everything with the user's own words is stored encrypted ("sealed") in the
// local database, so a copy of SyncR's files is useless without the key (localDb.ts keeps the
// key, protected by Windows). This layer sits under the database code: the app reads and
// writes plain rows as before, and only the disk sees sealed ones.
// The lookup fields (a table's id and indexes, e.g. a note's updatedAt) stay readable; all the
// other fields of a row are one encrypted block. Images (Blob fields) get their own block.
// Encrypting must be instant: the database doesn't wait for slow work in the middle of a save
// (and "filter" reads hand rows over one by one, at once). So it uses @noble/ciphers (AES-GCM,
// instant) instead of the browser's own encryption, which always takes a moment.

export const SEALED_TABLES = ['notes', 'attachments', 'settings', 'reminders', 'cards', 'games', 'events', 'linkPreviews', 'snapshots', 'videoFollows', 'videos', 'videoMarks', 'addedVideos', 'videoFolders', 'videoPlaces']

// i18n-ok
const SEALED = '_sealed' // the encrypted block: 12 bytes nonce + the encrypted JSON of the other fields
// i18n-ok
const BLOBS = '_blobs' // images: { field: { type, data: nonce + encrypted bytes } }

let key: Uint8Array | undefined
let keyArrived = () => {}
export const keyReady = new Promise<void>((resolve) => (keyArrived = resolve)) // the sealed database waits for it (db.ts)

export function setSealKey(bytes: Uint8Array) {
  key = bytes
  previewHmac = undefined
  forgetOpened()
  keyArrived()
}

// The key, for the PIN lock's lockboxes (pinLock.ts); undefined while locked
export const currentSealKey = () => key

// Also used for the sign-ins behind the PIN lock (secrets.ts)
export function sealBytes(bytes: Uint8Array) {
  if (!key) throw new Error(t('The local key is missing'))
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const sealed = gcm(key, nonce).encrypt(bytes)
  const out = new Uint8Array(12 + sealed.length)
  out.set(nonce)
  out.set(sealed, 12)
  return out
}

export function openBytes(data: Uint8Array) {
  if (!key) throw new Error(t('The local key is missing'))
  return gcm(key, data.subarray(0, 12)).decrypt(data.subarray(12))
}

// Text sealed into base64 and back: the mail cards, kept in localStorage (mailAlerts.ts).
// Opening throws without the key (locked) or if the text was changed.
export function sealString(text: string) {
  const bytes = sealBytes(new TextEncoder().encode(text))
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export function openString(base64: string) {
  return new TextDecoder().decode(openBytes(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))))
}

// ---------- Images ----------
// A Blob's bytes can only be read with waiting, which a save can't do. So the bytes of each
// image are noted when it's made (readyBlob / blobFromBytes) or opened (below), and sealing
// takes them from here. An image nobody noted is refused, so a missed place shows at once.

const blobBytes = new WeakMap<Blob, Uint8Array>()

export function blobFromBytes(bytes: Uint8Array<ArrayBuffer>, type: string) {
  const blob = new Blob([bytes], { type })
  blobBytes.set(blob, bytes)
  return blob
}

// Before saving an image made elsewhere (a pasted file, a canvas)
export async function readyBlob(blob: Blob) {
  if (!blobBytes.has(blob)) blobBytes.set(blob, new Uint8Array(await blob.arrayBuffer()))
  return blob
}

// ---------- Rows ----------

const opened = new WeakMap<object, object>() // stored row → plain row, so a row is opened only once

function seal(row: Record<string, unknown>, plainFields: string[]) {
  const out: Record<string, unknown> = {}
  const rest: Record<string, unknown> = {}
  const blobs: Record<string, { type: string; data: Uint8Array }> = {}
  for (const [field, value] of Object.entries(row)) {
    if (plainFields.includes(field)) out[field] = value
    else if (value instanceof Blob) {
      const bytes = blobBytes.get(value)
      if (!bytes) throw new Error(`Image not ready for encryption (${field})`) // i18n-ok: a bug in the app, not a message for the user
      blobs[field] = { type: value.type, data: sealBytes(bytes) }
    } else rest[field] = value
  }
  out[SEALED] = sealBytes(new TextEncoder().encode(JSON.stringify(rest)))
  if (Object.keys(blobs).length) out[BLOBS] = blobs
  return out
}

// Decrypting takes a moment (~0.2 ms per KB): the notes list, read again after each save, would
// freeze the app briefly with many notes. So each row's opened text is remembered by its id,
// with the nonce of its encrypted block: unchanged since (same nonce) = not decrypted again.
// Kept as text and parsed at each read, so every read still gets its own copy to change.
// Rows with images aren't remembered (big, and read rarely).
type Remembered = Map<string, { nonce: string; json: string }>
const allRemembered = new Set<Remembered>()

function forgetOpened() {
  allRemembered.forEach((remembered) => remembered.clear())
}

function openText(data: Uint8Array, id: unknown, remembered: Remembered | undefined) {
  if (!remembered) return new TextDecoder().decode(openBytes(data))
  const nonce = String.fromCharCode(...data.subarray(0, 12))
  const key = JSON.stringify(id)
  const known = remembered.get(key)
  if (known?.nonce === nonce) return known.json
  const json = new TextDecoder().decode(openBytes(data))
  remembered.set(key, { nonce, json })
  return json
}

function open<T>(stored: T, table: DBCoreTable, remembered?: Remembered): T {
  if (!stored || typeof stored !== 'object' || !(SEALED in stored)) return stored // not sealed (or missing)
  const known = opened.get(stored)
  if (known) return known as T
  const { [SEALED]: data, [BLOBS]: blobs, ...plain } = stored as Record<string, unknown>
  const id = table.schema.primaryKey.extractKey?.(stored)
  const row = { ...plain, ...JSON.parse(openText(data as Uint8Array, id, blobs ? undefined : remembered)) }
  for (const [field, blob] of Object.entries((blobs ?? {}) as Record<string, { type: string; data: Uint8Array }>)) {
    row[field] = blobFromBytes(openBytes(blob.data) as Uint8Array<ArrayBuffer>, blob.type)
  }
  opened.set(stored, row)
  return row as T
}

// The fields a table looks rows up by: its id and its indexes
function lookupFields(table: DBCoreTable) {
  const paths = [table.schema.primaryKey, ...table.schema.indexes].flatMap((index) => index.keyPath ?? [])
  return paths.map((path) => path.split('.')[0])
}

// The layer itself. Lowest level, under Dexie's own layers (live queries, hooks), so they all see plain rows.
export const sealingLayer: Middleware<DBCore> = {
  stack: 'dbcore',
  name: 'sealing',
  level: -10,
  create(down) {
    return {
      ...down,
      table(name) {
        const table = down.table(name)
        if (!SEALED_TABLES.includes(name)) return table
        const plainFields = lookupFields(table)
        const remembered: Remembered = new Map()
        allRemembered.add(remembered)
        const openRow = <T,>(stored: T) => open(stored, table, remembered)
        // .then(), never async/await: Dexie's promises carry which transaction is running, a
        // native await loses it (then a later step of the same save fails)
        return {
          ...table,
          mutate(req: DBCoreMutateRequest) {
            if (req.type !== 'add' && req.type !== 'put') return table.mutate(req)
            let values
            try {
              values = req.values.map((row) => seal(row, plainFields))
            } catch (error) {
              return Promise.reject(error) // a failed save; thrown here, Dexie loses track of its transactions
            }
            return table.mutate({ ...req, values })
          },
          get: (req: DBCoreGetRequest) => table.get(req).then(openRow),
          getMany: (req: DBCoreGetManyRequest) => table.getMany(req).then((rows) => rows.map(openRow)),
          query: (req: DBCoreQueryRequest) =>
            table.query(req).then((res) => (req.values ? { ...res, result: res.result.map(openRow) } : res)),
          openCursor: (req: DBCoreOpenCursorRequest) =>
            table.openCursor(req).then((cursor) => {
              if (!cursor || !req.values) return cursor
              // Like Dexie's own layers: the browser's cursor getters only work on the cursor itself
              return Object.create(cursor, {
                key: { get: () => cursor.key },
                primaryKey: { get: () => cursor.primaryKey },
                value: { get: () => openRow(cursor.value) },
              })
            }),
        }
      },
    }
  },
}

// Link cards are kept by their web address, which is a lookup field: sealed, they're kept by a
// scrambled form of it instead (same address = same result, but it can't be turned back).
// Scrambled with its own key, made from the local key (HKDF), not the local key itself.
let previewHmac: Promise<CryptoKey> | undefined

async function makePreviewHmac(bytes: Uint8Array<ArrayBuffer>) {
  const base = await crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveKey'])
  const info = new TextEncoder().encode('syncr link cards') // i18n-ok
  const params = { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info }
  return crypto.subtle.deriveKey(params, base, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
}

export async function previewKey(url: string) {
  if (!key) return url // not sealed (phone, browser)
  previewHmac ??= makePreviewHmac(key as Uint8Array<ArrayBuffer>)
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await previewHmac, new TextEncoder().encode(url)))
  return Array.from(mac, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
