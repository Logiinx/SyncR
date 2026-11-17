import { beforeAll, describe, expect, test, vi } from 'vitest'
import fc from 'fast-check'

// The PC lock (sealing.ts): what's locked must come back exactly the same, and anything
// changed or opened with another key must be refused, never turned into garbage.
// fast-check tries each rule on ~100 random inputs (and shrinks a failure to the smallest one).

vi.mock('../src/i18n', () => ({ t: (text: string) => text })) // the real one needs a browser page

const { openBytes, openString, previewKey, sealBytes, sealString, setSealKey } = await import('../src/sealing')

const newKey = () => crypto.getRandomValues(new Uint8Array(32))
const KEY = newKey()
const bytes = fc.uint8Array({ maxLength: 5000 })

beforeAll(() => setSealKey(KEY))

describe('PC lock', () => {
  test('without a key, nothing is locked or opened', async () => {
    vi.resetModules()
    const fresh = await import('../src/sealing') // a copy that never got a key
    expect(() => fresh.sealBytes(new Uint8Array([1]))).toThrow('The local key is missing')
    expect(() => fresh.openBytes(sealBytes(new Uint8Array([1])))).toThrow('The local key is missing')
  })

  test('bytes come back the same', () => {
    fc.assert(fc.property(bytes, (data) => {
      expect(openBytes(sealBytes(data))).toEqual(data)
    }))
  })

  test('a big image comes back the same', () => {
    const image = new Uint8Array(3_000_000).map((_, i) => (i * 7) % 256)
    expect(openBytes(sealBytes(image))).toEqual(image)
  })

  test('text comes back the same (any language, emoji, empty)', () => {
    fc.assert(fc.property(fc.string({ unit: 'binary', maxLength: 2000 }), (text) => {
      expect(openString(sealString(text))).toBe(text)
    }))
  })

  test('the same thing locked twice looks different', () => {
    // Each lock uses a new random nonce; a repeated one would weaken the lock.
    fc.assert(fc.property(bytes, (data) => {
      expect(sealBytes(data)).not.toEqual(sealBytes(data))
    }))
  })

  test('changing any single byte is refused', () => {
    const changed = bytes.chain((data) => fc.record({
      data: fc.constant(data),
      at: fc.nat({ max: data.length + 12 + 16 - 1 }), // nonce + locked data + check tag
      flip: fc.integer({ min: 1, max: 255 }),
    }))
    fc.assert(fc.property(changed, ({ data, at, flip }) => {
      const sealed = sealBytes(data)
      sealed[at] ^= flip
      expect(() => openBytes(sealed)).toThrow()
    }))
  })

  test('cut short or empty is refused', () => {
    fc.assert(fc.property(bytes, fc.nat(), (data, cut) => {
      const sealed = sealBytes(data)
      expect(() => openBytes(sealed.subarray(0, cut % sealed.length))).toThrow()
    }))
  })

  test('another key is refused', () => {
    fc.assert(fc.property(bytes, (data) => {
      const sealed = sealBytes(data)
      setSealKey(newKey())
      try {
        expect(() => openBytes(sealed)).toThrow()
      } finally {
        setSealKey(KEY)
      }
    }), { numRuns: 20 })
  })
})

describe('link card addresses', () => {
  test('the same address always gives the same scrambled form, another address another one', async () => {
    await fc.assert(fc.asyncProperty(fc.webUrl(), fc.webUrl(), async (a, b) => {
      const scrambledA = await previewKey(a)
      expect(scrambledA).toMatch(/^[0-9a-f]{64}$/)
      expect(scrambledA).not.toContain(a)
      expect(await previewKey(a)).toBe(scrambledA)
      if (a !== b) expect(await previewKey(b)).not.toBe(scrambledA)
    }), { numRuns: 30 })
  })

  test('another key gives another scrambled form', async () => {
    const before = await previewKey('https://example.com/page')
    setSealKey(newKey())
    try {
      expect(await previewKey('https://example.com/page')).not.toBe(before)
    } finally {
      setSealKey(KEY)
    }
  })
})
