import { beforeEach, describe, expect, test, vi } from 'vitest'

// An account whose alerts are off (Settings → Mail, the bell; mailAlerts.ts): its new mail
// never makes a pop-up card, and counts as missed (Mail tab) instead. Gmail, localStorage and
// the stored accounts are replaced by small in-memory stand-ins.

const env = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  raw: new Map<string, string>(),
  accounts: [] as { email: string; enabled: boolean; alerts?: boolean }[],
  unread: {} as Record<string, string[]>, // account → unread message ids
  changed: true, // whether the mailbox changed since the last check
}))

vi.mock('../src/i18n', () => ({ t: (text: string) => text }))
vi.mock('../src/localState', () => ({
  read: (key: string, fallback: unknown) => (env.store.has(key) ? env.store.get(key) : fallback),
  write: (key: string, value: unknown) => env.store.set(key, value),
}))
vi.mock('../src/sealing', () => ({ currentSealKey: () => null, openString: (s: string) => s, sealString: (s: string) => s }))
vi.mock('../src/safeSenders', () => ({ senderAddress: (s: string) => s }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }))
vi.mock('../src/gmail', () => ({
  loadAccounts: () => env.accounts.map((a) => ({ ...a, refreshToken: '', color: 'blue' })),
  gmailApi: async (email: string, path: string) => {
    if (path.startsWith('history')) return { history: env.changed ? [{}] : [], historyId: '2' }
    if (path === 'profile') return { historyId: '1' }
    if (path.startsWith('messages?')) return { messages: (env.unread[email] ?? []).map((id) => ({ id, threadId: id })) }
    return { threadId: 't', payload: { headers: [] }, snippet: '', internalDate: String(Date.now()) }
  },
}))
vi.stubGlobal('window', { dispatchEvent: () => true })
vi.stubGlobal('localStorage', {
  getItem: (key: string) => env.raw.get(key) ?? null,
  setItem: (key: string, value: string) => env.raw.set(key, value),
})
vi.stubGlobal('DOMParser', class {
  parseFromString(text: string) {
    return { documentElement: { textContent: text } }
  }
})
// Without a seal key (phone, browser, here) cards are stored like the rest (localState)
const cards = () => ((env.store.get('syncr.gmail.alerts') as { key: string }[] | undefined) ?? []).map((a) => a.key)
const missed = () => (env.store.get('syncr.gmail.missed') as string[] | undefined) ?? []

type Mail = typeof import('../src/mailAlerts')
let mail: Mail

beforeEach(async () => {
  vi.resetModules()
  env.store.clear()
  env.raw.clear()
  env.changed = true
  env.accounts = [{ email: 'loud@x', enabled: true }, { email: 'quiet@x', enabled: true, alerts: false }]
  env.unread = {}
  // Both checked once before, with nothing unread then
  env.store.set('syncr.gmail.seen', { 'loud@x': [], 'quiet@x': [] })
  mail = await import('../src/mailAlerts')
})

describe('alerts off for an account', () => {
  test('its new mail is missed, not a card; the other account still pops up', async () => {
    env.unread = { 'loud@x': ['a'], 'quiet@x': ['b'] }
    await mail.checkMail()
    expect(cards()).toEqual(['mail:loud@x:a'])
    expect(missed()).toEqual(['mail:quiet@x:b'])
  })

  test('turned off later: its cards go to missed, a card open to read stays', async () => {
    env.accounts[1].alerts = true
    env.unread = { 'quiet@x': ['b', 'c'] }
    await mail.checkMail()
    expect(cards().sort()).toEqual(['mail:quiet@x:b', 'mail:quiet@x:c'])
    await mail.runMailAction('mail:quiet@x:c', 'mail-opened')
    env.accounts[1].alerts = false
    env.changed = false // turning the bell off checks again (gmail-change), nothing new in Gmail
    await mail.checkMail()
    expect(cards()).toEqual(['mail:quiet@x:c'])
    expect(missed()).toEqual(['mail:quiet@x:b'])
  })

  test('back on: only mail arriving from then pops up', async () => {
    env.unread = { 'quiet@x': ['b'] }
    await mail.checkMail()
    env.accounts[1].alerts = undefined
    env.unread = { 'quiet@x': ['b', 'd'] }
    await mail.checkMail()
    expect(cards()).toEqual(['mail:quiet@x:d'])
    expect(missed()).toEqual(['mail:quiet@x:b'])
  })

  test('its missed mark goes once the mail is read anywhere', async () => {
    env.unread = { 'quiet@x': ['b'] }
    await mail.checkMail()
    env.unread = { 'quiet@x': [] }
    await mail.checkMail()
    expect(missed()).toEqual([])
  })
})
