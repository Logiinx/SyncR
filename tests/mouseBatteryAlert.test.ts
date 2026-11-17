import { beforeEach, describe, expect, test, vi } from 'vitest'

// The mouse battery's low warning (mouseBattery.ts): when the card for the pop-up shows and goes.
// The checks come from Rust as "mouse-battery" events: here they're sent by hand. localStorage
// and Tauri are replaced by small in-memory stand-ins.

const env = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
}))

vi.mock('../src/i18n', () => ({ t: (text: string) => text, subscribe: () => () => {} }))
vi.mock('../src/dates', () => ({ clockTime: () => '' }))
vi.mock('../src/localState', () => ({
  read: (key: string, fallback: unknown) => (env.store.has(key) ? env.store.get(key) : fallback),
  write: (key: string, value: unknown) => env.store.set(key, value),
}))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: async () => {} }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: (name: string, handler: (event: { payload: unknown }) => void) => {
    env.handlers.set(name, handler)
    return Promise.resolve(() => {})
  },
}))
vi.stubGlobal('window', { dispatchEvent: () => true })

type Battery = typeof import('../src/mouseBattery')
let battery: Battery

// A fresh start of SyncR with these settings
async function start(settings = { on: true, low: 15 }) {
  vi.resetModules()
  env.handlers.clear()
  env.store.set('syncr.mouseBattery', { ...settings, warned: true })
  battery = await import('../src/mouseBattery')
  battery.startMouseBattery()
}

// One check's answer (null: no answer)
function check(percent: number | null, charging = false) {
  const last = percent === null ? null : { percent, charging, millivolts: 3800, at: 0 }
  env.handlers.get('mouse-battery')!({ payload: { last, answering: percent !== null } })
}

const card = () => battery.loadLowAlert()

beforeEach(() => env.store.clear())

describe('low battery card', () => {
  test('shows once when it gets to the level, its percent follows', async () => {
    await start()
    check(40)
    check(16)
    expect(card()).toBeNull()
    check(15)
    const first = card()
    expect(first?.percent).toBe(15)
    check(14)
    expect(card()).toEqual({ percent: 14, at: first!.at })
  })

  test('after Done: not again until a charge above the level', async () => {
    await start()
    check(15)
    battery.closeLowAlert()
    check(14)
    check(16) // reading going up and down without charging
    check(15)
    expect(card()).toBeNull()
    check(14, true) // charging, still at or below the level: not enough
    check(12)
    expect(card()).toBeNull()
    check(50, true) // charged above it
    check(30)
    check(15)
    expect(card()?.percent).toBe(15)
  })

  test('goes when charging starts', async () => {
    await start()
    check(10)
    expect(card()).not.toBeNull()
    check(10, true)
    expect(card()).toBeNull()
  })

  test('no answer leaves it as it is', async () => {
    await start()
    check(10)
    const shown = card()
    check(null)
    expect(card()).toEqual(shown)
  })

  test('a new start warns again, and a card from the last run waits for the first check', async () => {
    await start()
    check(10)
    battery.closeLowAlert()
    env.store.set('syncr.mouseBattery.alert', { percent: 10, at: 1 }) // left by a crash
    await start()
    expect(card()).toBeNull()
    check(10)
    expect(card()?.percent).toBe(10)
  })

  test('the level: raised above the percent shows it, lowered below it removes it', async () => {
    await start()
    check(20)
    expect(card()).toBeNull()
    battery.saveMouseBattery({ low: 25 })
    check(20)
    expect(card()?.percent).toBe(20)
    battery.saveMouseBattery({ low: 15 })
    check(20)
    expect(card()).toBeNull()
  })

  test('turning the module off removes it, and nothing shows while off', async () => {
    await start()
    check(10)
    battery.saveMouseBattery({ on: false })
    expect(card()).toBeNull()
    check(5)
    expect(card()).toBeNull()
  })
})
