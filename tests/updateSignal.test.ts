import { beforeEach, describe, expect, test, vi } from 'vitest'

// Instant updates: the release's notes in instant mail's queue (instantMail.ts sorts them from
// mail signals), and when the chosen check pauses for the 6-hour safety check (updateSignal.ts).
// localStorage and the instant mail status are replaced by small in-memory stand-ins.

const env = vi.hoisted(() => ({ store: new Map<string, unknown>(), instantOn: true }))

vi.mock('../src/i18n', () => ({ t: (text: string) => text }))
vi.mock('../src/gmail', () => ({ gmailApi: async () => ({}), googleApi: async () => ({}), loadAccounts: () => [] }))
vi.mock('../src/mailAlerts', () => ({ checkMail: async () => {} }))
vi.mock('../src/localState', () => ({
  read: (key: string, fallback: unknown) => (env.store.has(key) ? env.store.get(key) : fallback),
  write: (key: string, value: unknown) => env.store.set(key, value),
}))

const { sortSignals } = await import('../src/instantMail')
vi.doMock('../src/instantMail', () => ({ instantOn: () => env.instantOn }))
const { checkEvery, noteFound, noteSignal, signalsWork } = await import('../src/updateSignal')

const note = (version: string) => ({ ackId: 'a', message: { data: btoa(version), attributes: { syncr: 'update' } } })
const mail = { ackId: 'b', message: { data: btoa('{"emailAddress":"x","historyId":1}') } }

describe('sorting the queue', () => {
  test('a mail signal checks the mail, a note gives its version', () => {
    expect(sortSignals([mail])).toEqual({ mail: true, versions: [] })
    expect(sortSignals([note('v0.89.0')])).toEqual({ mail: false, versions: ['v0.89.0'] })
    expect(sortSignals([note('test'), mail])).toEqual({ mail: true, versions: ['test'] })
  })

  test('a note with broken data is still a note', () => {
    const broken = { ackId: 'c', message: { data: '%%%', attributes: { syncr: 'update' } } }
    expect(sortSignals([broken])).toEqual({ mail: false, versions: [''] })
    expect(sortSignals([{ ackId: 'd' }])).toEqual({ mail: true, versions: [] })
  })
})

describe('pausing the chosen check', () => {
  beforeEach(() => {
    env.store.clear()
    env.instantOn = true
  })

  test('the chosen check runs until a first note comes', () => {
    expect(signalsWork()).toBe(false)
    expect(checkEvery(1)).toBe(1)
    noteSignal('test')
    expect(signalsWork()).toBe(true)
    expect(checkEvery(1)).toBe(360)
    expect(checkEvery(15)).toBe(360)
  })

  test('never more often than chosen, and not at all with "only at start-up"', () => {
    noteSignal('v0.89.0')
    expect(checkEvery(0)).toBe(0)
    expect(checkEvery(720)).toBe(720)
  })

  test('instant mail stopped: the chosen check comes back', () => {
    noteSignal('v0.89.0')
    env.instantOn = false
    expect(checkEvery(1)).toBe(1)
  })

  test('a version no note announced: notes stopped, until the next one', () => {
    noteSignal('v0.89.0')
    noteFound('0.89.0') // the one announced: still fine
    expect(signalsWork()).toBe(true)
    noteSignal('test') // the button's test note keeps the version announced
    noteFound('0.89.0')
    expect(signalsWork()).toBe(true)
    noteFound('0.90.0')
    expect(signalsWork()).toBe(false)
    expect(checkEvery(1)).toBe(1)
    noteSignal('v0.91.0')
    expect(signalsWork()).toBe(true)
  })
})
