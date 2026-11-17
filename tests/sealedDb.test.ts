import 'fake-indexeddb/auto' // an in-memory database in place of the browser's (first, before Dexie loads)
import { beforeEach, describe, expect, test, vi } from 'vitest'
import fc from 'fast-check'
import Dexie from 'dexie'

// The PC's sealed database: the real schema (db.ts) and the real sealing layer (sealing.ts) on a
// fake in-memory database. Rows must come back the same through every way the app reads them,
// while what's on disk shows none of the user's words.

vi.mock('../src/i18n', () => ({ t: (text: string) => text })) // the real one needs a browser page
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }))

const { defineSchema } = await import('../src/db')
const { SEALED_TABLES, blobFromBytes, readyBlob, sealingLayer, setSealKey } = await import('../src/sealing')

const KEY = crypto.getRandomValues(new Uint8Array(32))
const SECRET = 'TOP-SECRET-words'

let count = 0
let name = ''
function sealedDb() {
  const d = new Dexie(name)
  defineSchema(d)
  d.use(sealingLayer)
  return d
}

// The same database as the disk sees it: no sealing layer
async function onDisk(table: string) {
  const raw = new Dexie(name)
  await raw.open()
  const rows = await raw.table(table).toArray()
  raw.close()
  return rows
}

// Everything in the stored rows as text, bytes included, to look for the user's words
const asText = (rows: unknown) =>
  JSON.stringify(rows, (_, value) => (value instanceof Uint8Array ? String.fromCharCode(...value) : value))

const note = (id: string, extra: object = {}) => ({ id, title: `${SECRET} title`, text: `${SECRET} text`, content: { type: 'doc' }, updatedAt: 1, ...extra })

beforeEach(() => {
  setSealKey(KEY)
  name = `test-${++count}`
})

describe('which tables are sealed', () => {
  // A new table must be sorted into one of these two lists on purpose: one with the user's words
  // that isn't sealed would sit on the disk in plain text.
  const NOT_SEALED = [
    'alertMarks', // reminder alerts done or snoozed: ids, times, the device's name
    'deletions', // deleted notes: id + time
    'keys', // the phone's sync key (an unreadable key object; the PC keeps it with Windows)
    'remoteFiles', // Dropbox file list: paths are ids, revisions, times
    'synced', // last synced revision per note: id, revision, time
    'syncListing', // Dropbox's bookmark of its file list
    'unusedImages', // images no longer in a note: id + time
  ]

  test('every table is either sealed or listed here as holding no private words', () => {
    const tables = sealedDb().tables.map((table) => table.name).sort()
    expect(tables).toEqual([...SEALED_TABLES, ...NOT_SEALED].sort())
  })
})

describe('sealed rows', () => {
  test('any note comes back the same', async () => {
    const d = sealedDb()
    let i = 0
    await fc.assert(fc.asyncProperty(fc.string({ unit: 'binary' }), fc.jsonValue({ maxDepth: 4 }), async (text, content) => {
      const row = { id: `n${i++}`, title: text, text, content, updatedAt: i, pinned: i % 2 === 0 }
      await d.table('notes').put(row)
      expect(await d.table('notes').get(row.id)).toEqual(JSON.parse(JSON.stringify(row)))
    }))
    d.close()
  })

  test('the disk shows only the id and the lookup fields, never the words', async () => {
    const d = sealedDb()
    await d.table('notes').put(note('n1', { updatedAt: 42 }))
    await d.table('cards').put({ id: 'c1', text: SECRET, updatedAt: 3 })
    await d.table('settings').put({ name: 'theme', value: SECRET })
    d.close()
    const [stored] = await onDisk('notes')
    expect(Object.keys(stored).sort()).toEqual(['_sealed', 'id', 'updatedAt'])
    expect(stored.updatedAt).toBe(42)
    for (const table of ['notes', 'cards', 'settings']) expect(asText(await onDisk(table))).not.toContain(SECRET)
  })

  test('every way of reading opens the rows', async () => {
    const d = sealedDb()
    const notes = d.table('notes')
    await notes.bulkPut([note('a', { updatedAt: 3 }), note('b', { updatedAt: 1 }), note('c', { updatedAt: 2 })])
    const opened = (rows: { title?: string }[]) => rows.every((row) => row.title === `${SECRET} title`)
    expect(opened([await notes.get('a')])).toBe(true) // get
    expect(opened(await notes.bulkGet(['a', 'b']))).toBe(true) // getMany
    expect(opened(await notes.toArray())).toBe(true) // query
    expect((await notes.orderBy('updatedAt').toArray()).map((row) => row.id)).toEqual(['b', 'c', 'a']) // sorted by a lookup field
    expect((await notes.where('updatedAt').above(1).toArray()).map((row) => row.id).sort()).toEqual(['a', 'c'])
    expect((await notes.filter((row) => row.text.startsWith(SECRET)).toArray()).length).toBe(3) // cursor
    const seen: string[] = []
    await notes.each((row) => void seen.push(row.title))
    expect(seen).toEqual(Array(3).fill(`${SECRET} title`))
    d.close()
  })

  test('an update keeps the other fields', async () => {
    const d = sealedDb()
    await d.table('notes').put(note('n1'))
    await d.table('notes').update('n1', { title: 'new title', updatedAt: 5 })
    expect(await d.table('notes').get('n1')).toEqual(note('n1', { title: 'new title', updatedAt: 5 }))
    d.close()
  })

  test('several steps in one save, with waiting in between, all happen', async () => {
    // The sealing layer must not lose track of the save (the "no async/await inside" rule)
    const d = sealedDb()
    await d.transaction('rw', d.table('notes'), d.table('cards'), async () => {
      await d.table('notes').put(note('n1'))
      const read = await d.table('notes').get('n1')
      await d.table('cards').put({ id: 'c1', text: read.title, updatedAt: 1 })
      await d.table('notes').update('n1', { updatedAt: 2 })
    })
    expect((await d.table('cards').get('c1')).text).toBe(`${SECRET} title`)
    expect((await d.table('notes').get('n1')).updatedAt).toBe(2)
    d.close()
  })

  test('a row changed in place reads the new version (not an old remembered one)', async () => {
    const d = sealedDb()
    await d.table('notes').put(note('n1'))
    await d.table('notes').get('n1')
    await d.table('notes').put(note('n1', { title: 'second' }))
    expect((await d.table('notes').get('n1')).title).toBe('second')
    d.close()
  })

  test('tables that aren\'t sealed are stored as they are', async () => {
    const d = sealedDb()
    await d.table('deletions').put({ id: 'gone', deletedAt: 7 })
    d.close()
    expect(await onDisk('deletions')).toEqual([{ id: 'gone', deletedAt: 7 }])
  })
})

describe('images', () => {
  test('an image comes back with the same bytes and type, locked on disk', async () => {
    const d = sealedDb()
    const bytes = new TextEncoder().encode(`${SECRET} picture bytes`)
    await d.table('attachments').put({ id: 'img', noteId: 'n1', blob: blobFromBytes(bytes.slice(), 'image/png') })
    const back = await d.table('attachments').get('img')
    expect(back.blob.type).toBe('image/png')
    expect(new Uint8Array(await back.blob.arrayBuffer())).toEqual(bytes)
    expect(back.noteId).toBe('n1')
    d.close()
    expect(asText(await onDisk('attachments'))).not.toContain(SECRET)
  })

  test('an image made elsewhere saves once it\'s readied', async () => {
    const d = sealedDb()
    const pasted = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })
    await d.table('attachments').put({ id: 'img', blob: await readyBlob(pasted) })
    expect(new Uint8Array(await (await d.table('attachments').get('img')).blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    d.close()
  })

  test('an image that wasn\'t readied is refused, and nothing in that save is kept', async () => {
    const d = sealedDb()
    const save = d.transaction('rw', d.table('notes'), d.table('attachments'), async () => {
      await d.table('notes').put(note('n1'))
      await d.table('attachments').put({ id: 'img', blob: new Blob([new Uint8Array([1])]) })
    })
    await expect(save).rejects.toThrow('Image not ready for encryption')
    expect(await d.table('notes').get('n1')).toBeUndefined()
    d.close()
  })
})

describe('the key', () => {
  test('rows are never opened with another key, even ones read just before', async () => {
    const d = sealedDb()
    await d.table('notes').put(note('n1'))
    expect((await d.table('notes').get('n1')).title).toBe(`${SECRET} title`) // now remembered
    setSealKey(crypto.getRandomValues(new Uint8Array(32)))
    await expect(d.table('notes').get('n1')).rejects.toThrow()
    await expect(d.table('notes').toArray()).rejects.toThrow()
    setSealKey(KEY)
    expect((await d.table('notes').get('n1')).title).toBe(`${SECRET} title`)
    d.close()
  })
})
