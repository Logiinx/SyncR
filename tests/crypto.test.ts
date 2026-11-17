import { beforeEach, describe, expect, test, vi } from 'vitest'
import fc from 'fast-check'

// The Dropbox lock (crypto.ts): everything synced is locked with a key made from the passphrase.
// Dropbox, Windows' secret store and the phone's database are replaced by small in-memory
// stand-ins; the locking itself is the real one.

const env = vi.hoisted(() => ({
  dropbox: new Map<string, Uint8Array>(),
  secrets: new Map<string, string>(), // PC: Windows' secret store
  phoneKeys: new Map<string, { name: string; key: CryptoKey }>(), // phone: its database
  boxRefreshed: 0, // PIN lock's passphrase lockbox told about a new key
}))

vi.mock('../src/i18n', () => ({ t: (text: string) => text })) // the real one needs a browser page
vi.mock('../src/dropbox', () => ({
  download: async (path: string) => env.dropbox.get(path) ?? null,
  upload: async (path: string, data: Uint8Array, mode: string) => {
    if (mode === 'add' && env.dropbox.has(path)) return null // Dropbox refuses: already there
    env.dropbox.set(path, data)
    return 'rev'
  },
}))
vi.mock('../src/secrets', () => ({
  SYNC_KEY_SECRET: 'sync-key',
  getSecret: (name: string) => env.secrets.get(name) ?? null,
  setSecret: async (name: string, value: string | null) => {
    if (value === null) env.secrets.delete(name)
    else env.secrets.set(name, value)
    return true
  },
}))
vi.mock('../src/db', () => ({
  db: {
    keys: {
      get: async (name: string) => env.phoneKeys.get(name),
      put: async (row: { name: string; key: CryptoKey }) => void env.phoneKeys.set(row.name, row),
      delete: async (name: string) => void env.phoneKeys.delete(name),
    },
  },
}))
vi.mock('../src/pinLock', () => ({ refreshPassphraseBox: async () => void env.boxRefreshed++ }))

vi.stubGlobal('window', new EventTarget()) // crypto.ts tells the app about key changes

// A fresh copy of crypto.ts, as on another device (each device keeps its own key in memory)
async function device(pc: boolean) {
  vi.resetModules()
  vi.doMock('@tauri-apps/api/core', () => ({ isTauri: () => pc })) // fixed per device: each stays what it is
  const crypto = await import('../src/crypto')
  return { ...crypto, pc }
}

const PASSPHRASE = 'correct horse battery'
const bytes = fc.uint8Array({ maxLength: 5000 })

beforeEach(() => {
  env.dropbox.clear()
  env.secrets.clear()
  env.phoneKeys.clear()
  env.boxRefreshed = 0
})

describe('Dropbox lock', () => {
  const newKey = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])

  test('bytes come back the same', async () => {
    const { encrypt, decrypt } = await device(false)
    const key = await newKey()
    await fc.assert(fc.asyncProperty(bytes, async (data) => {
      expect(await decrypt(key, await encrypt(key, data as Uint8Array<ArrayBuffer>))).toEqual(data)
    }))
  })

  test('the same thing locked twice looks different', async () => {
    const { encrypt } = await device(false)
    const key = await newKey()
    await fc.assert(fc.asyncProperty(bytes, async (data) => {
      const once = await encrypt(key, data as Uint8Array<ArrayBuffer>)
      expect(await encrypt(key, data as Uint8Array<ArrayBuffer>)).not.toEqual(once)
    }))
  })

  test('a changed byte, a cut or another key is refused', async () => {
    const { encrypt, decrypt } = await device(false)
    const key = await newKey()
    const other = await newKey()
    const cases = bytes.chain((data) => fc.record({
      data: fc.constant(data),
      at: fc.nat({ max: data.length + 12 + 16 - 1 }), // IV + locked data + check tag
      flip: fc.integer({ min: 1, max: 255 }),
      cut: fc.nat({ max: data.length + 12 + 16 - 1 }),
    }))
    await fc.assert(fc.asyncProperty(cases, async ({ data, at, flip, cut }) => {
      const locked = await encrypt(key, data as Uint8Array<ArrayBuffer>)
      const changed = locked.slice()
      changed[at] ^= flip
      await expect(decrypt(key, changed)).rejects.toThrow()
      await expect(decrypt(key, locked.subarray(0, cut))).rejects.toThrow()
      await expect(decrypt(other, locked)).rejects.toThrow()
    }))
  })
})

// The passphrase turns into the key slowly on purpose (600,000 rounds, ~0.3 s), so these tests
// use a few passphrases instead of a hundred random ones.
describe('passphrase', () => {
  test('PC and phone with the same passphrase open each other\'s data', async () => {
    const pc = await device(true)
    await pc.createPassphrase(PASSPHRASE)
    const phone = await device(false)
    expect(await phone.unlock(PASSPHRASE)).toBe(true)
    expect(env.secrets.has('sync-key')).toBe(true) // each kept its key in its own place
    expect(env.phoneKeys.has('sync')).toBe(true)

    const pcKey = (await pc.getKey())!
    const phoneKey = (await phone.getKey())!
    const note = new TextEncoder().encode('Ma note ✨ with emoji 🎉')
    expect(await phone.decrypt(phoneKey, await pc.encrypt(pcKey, note))).toEqual(note)
    expect(await pc.decrypt(pcKey, await phone.encrypt(phoneKey, note))).toEqual(note)
  })

  test('the phone\'s key can never be read out, the PC\'s only by the PC (for Windows to store)', async () => {
    const phone = await device(false)
    await phone.createPassphrase(PASSPHRASE)
    expect((await phone.getKey())!.extractable).toBe(false)
    expect(env.secrets.size).toBe(0)

    const pc = await device(true)
    expect(await pc.unlock(PASSPHRASE)).toBe(true)
    expect(env.secrets.get('sync-key')).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect((await pc.getKey())!.extractable).toBe(false) // the copy in memory can't be read out
  })

  test('a wrong passphrase is refused and nothing is saved', async () => {
    const first = await device(false)
    await first.createPassphrase(PASSPHRASE)
    const other = await device(true)
    for (const wrong of ['correct horse batter', 'Correct horse battery', 'correct horse battery ', '']) {
      expect(await other.unlock(wrong)).toBe(false)
    }
    expect(await other.getKey()).toBeUndefined()
    expect(env.secrets.size).toBe(0)
  })

  test('any passphrase works, in any language', async () => {
    const samples = ['motdepasse-àéîôù', 'пароль-пароль', '密码密码密码密码', '🔑🔑🔑🔑🔑🔑🔑🔑', 'a'.repeat(500)]
    for (const passphrase of samples) {
      env.dropbox.clear()
      const first = await device(true)
      await first.createPassphrase(passphrase)
      const second = await device(false)
      expect(await second.unlock(passphrase)).toBe(true)
    }
  })

  test('a second passphrase can\'t overwrite the first one', async () => {
    const first = await device(false)
    await first.createPassphrase(PASSPHRASE)
    const saved = env.dropbox.get('/crypto.json')
    const second = await device(true)
    await expect(second.createPassphrase('another passphrase')).rejects.toThrow('A passphrase was just created on another device')
    expect(env.dropbox.get('/crypto.json')).toBe(saved)
    expect(await second.getKey()).toBeUndefined()
  })

  test('unlocking with no passphrase in Dropbox says so', async () => {
    const phone = await device(false)
    expect(await phone.hasPassphrase()).toBe(false)
    await expect(phone.unlock(PASSPHRASE)).rejects.toThrow('No passphrase found in Dropbox')
  })

  test('forgetting the key, on both devices', async () => {
    for (const pc of [true, false]) {
      env.dropbox.clear()
      const one = await device(pc)
      await one.createPassphrase(PASSPHRASE)
      expect(await one.getKey()).toBeDefined()
      await one.forgetKey()
      expect(await one.getKey()).toBeUndefined()
    }
  })
})

describe('PIN lock\'s passphrase lockbox (PC)', () => {
  test('it learns about a new passphrase, on the PC only', async () => {
    const phone = await device(false)
    await phone.createPassphrase(PASSPHRASE)
    expect(env.boxRefreshed).toBe(0)
    const pc = await device(true)
    await pc.unlock(PASSPHRASE)
    expect(env.boxRefreshed).toBe(1)
  })

  test('the key it rebuilds from the passphrase is the sync key', async () => {
    const pc = await device(true)
    await pc.createPassphrase(PASSPHRASE)
    const settings = (await pc.passphraseSettings())!
    expect(settings.iterations).toBe(600_000)
    const rebuilt = await pc.passphraseKey(PASSPHRASE, settings.salt, settings.iterations)
    const note = new TextEncoder().encode('a note')
    expect(await pc.decrypt((await pc.getKey())!, await pc.encrypt(rebuilt, note))).toEqual(note)
  })

  test('no settings when this device\'s key belongs to another passphrase', async () => {
    const pc = await device(true)
    await pc.createPassphrase(PASSPHRASE)
    env.dropbox.clear() // the passphrase was reset (Dropbox emptied), then another one made elsewhere
    const phone = await device(false)
    await phone.createPassphrase('another passphrase')
    expect(await pc.passphraseSettings()).toBeNull()
    expect(await phone.passphraseSettings()).not.toBeNull()
  })
})
