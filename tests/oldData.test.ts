import 'fake-indexeddb/auto' // an in-memory database in place of the browser's (first, before Dexie loads)
import { describe, expect, test, vi } from 'vitest'
import Dexie from 'dexie'
import { readdirSync, readFileSync } from 'node:fs'

// Data locked by older versions must still open: samples made once with that version's code
// (tests/samples/, a made-up key and passphrase) and NEVER remade or edited. If one fails, the
// change would make existing notes unreadable after an update. A new format adds a new sample
// file; the old ones stay, since devices still hold data in the old format.

const dropboxFiles = new Map<string, Uint8Array>()
vi.mock('../src/i18n', () => ({ t: (text: string) => text })) // the real one needs a browser page
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }))
vi.mock('../src/dropbox', () => ({ download: async (path: string) => dropboxFiles.get(path) ?? null, upload: async () => 'rev' }))
vi.mock('../src/secrets', () => ({ SYNC_KEY_SECRET: 's', getSecret: () => null, setSecret: async () => true }))
vi.mock('../src/pinLock', () => ({ refreshPassphraseBox: async () => {} }))
vi.stubGlobal('window', new EventTarget())

const { defineSchema } = await import('../src/db')
const { decrypt, fromBase64, getKey, unlock } = await import('../src/crypto')
const { openBytes, openString, previewKey, sealingLayer, setSealKey } = await import('../src/sealing')

const SAMPLES = readdirSync('tests/samples').filter((file) => file.endsWith('.json'))

// Stored rows were written with bytes as { bytes: base64 }
const asStored = (row: unknown) =>
  JSON.parse(JSON.stringify(row), (_, value) => (value && typeof value === 'object' && 'bytes' in value ? fromBase64(value.bytes) : value))

test('there are samples', () => {
  expect(SAMPLES.length).toBeGreaterThan(0)
})

describe.each(SAMPLES)('%s', (file) => {
  const sample = JSON.parse(readFileSync(`tests/samples/${file}`, 'utf8'))

  test('Dropbox: the passphrase unlocks, the synced note and image open', async () => {
    const { dropbox } = sample
    dropboxFiles.set('/crypto.json', new TextEncoder().encode(dropbox.cryptoJson))
    expect(await unlock(dropbox.passphrase)).toBe(true)
    const key = (await getKey())!
    const note = JSON.parse(new TextDecoder().decode(await decrypt(key, fromBase64(dropbox.note.locked))))
    expect(note).toEqual(dropbox.note.plain)
    expect(await decrypt(key, fromBase64(dropbox.image.locked))).toEqual(fromBase64(dropbox.image.plain))
  })

  test('PC: locked bytes and text open, link addresses scramble the same way', async () => {
    const { pc } = sample
    setSealKey(fromBase64(pc.key))
    expect(openBytes(fromBase64(pc.bytes.locked))).toEqual(fromBase64(pc.bytes.plain))
    expect(openString(pc.text.locked)).toBe(pc.text.plain)
    expect(await previewKey(pc.linkAddress.plain)).toBe(pc.linkAddress.scrambled)
  })

  test('PC: a note and an image stored on disk open through the database', async () => {
    const { pc } = sample
    setSealKey(fromBase64(pc.key))
    const name = `old-${file}`
    const disk = new Dexie(name) // as on disk: no sealing layer
    defineSchema(disk)
    await disk.table('notes').put(asStored(pc.noteRow.stored))
    await disk.table('attachments').put(asStored(pc.imageRow.stored))
    disk.close()

    const d = new Dexie(name)
    defineSchema(d)
    d.use(sealingLayer)
    expect(await d.table('notes').get(pc.noteRow.plain.id)).toEqual(pc.noteRow.plain)
    const image = await d.table('attachments').get(pc.imageRow.plain.id)
    expect(image.noteId).toBe(pc.imageRow.plain.noteId)
    expect(image.blob.type).toBe(pc.imageRow.plain.type)
    expect(new Uint8Array(await image.blob.arrayBuffer())).toEqual(fromBase64(pc.imageRow.plain.bytes))
    d.close()
  })
})
