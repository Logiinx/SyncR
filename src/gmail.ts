import { invoke, isTauri } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'
import {
  appAddress,
  base64Url,
  challengeFor,
  CLIENT_ID,
  idTokenClaims,
  redirectUri,
  tokenRequest,
} from './google'
import { getSecret, GMAIL_SECRET, setSecret } from './secrets'

// Gmail accounts (PC: pop-ups for new mail). Each account has its own Google sign-in, apart
// from the Google Calendar one (google.ts): adding or removing a Gmail account never touches
// Reminders. Same client, proxy and PC sign-in as Calendar. Remembered per device, not synced
// (secrets.ts: encrypted on the PC).

const SCOPE = 'https://www.googleapis.com/auth/gmail.modify' // read, mark as read/unread
// Instant mail (instantMail.ts): reads Gmail's "new mail" signals from SyncR's Google Cloud queue
export const PUBSUB_SCOPE = 'https://www.googleapis.com/auth/pubsub'
const VERIFIER_KEY = 'syncr.gmail.verifier'
const STATE = 'gmail' // tells this sign-in's return apart from Calendar's and Dropbox's

export interface GmailAccount {
  email: string
  refreshToken: string
  accessToken?: string
  expiresAt?: number // ms since epoch
  color: string // a palette name (var(--text-<name>)): the strip on its pop-up cards
  enabled: boolean // off: not checked for new mail
  expired?: boolean // Google refused the sign-in (e.g. access removed): sign in again
  pubsub?: boolean // signed in with the Pub/Sub permission: collects instant mail's signals
}

export function loadAccounts(): GmailAccount[] {
  try {
    return JSON.parse(getSecret(GMAIL_SECRET) ?? '[]')
  } catch {
    return []
  }
}

function saveAccounts(accounts: GmailAccount[]) {
  void setSecret(GMAIL_SECRET, JSON.stringify(accounts))
  window.dispatchEvent(new Event('gmail-change'))
}

function updateAccount(email: string, change: Partial<GmailAccount>) {
  saveAccounts(loadAccounts().map((a) => (a.email === email ? { ...a, ...change } : a)))
}

export const setAccountEnabled = (email: string, enabled: boolean) => updateAccount(email, { enabled })
export const setAccountColor = (email: string, color: string) => updateAccount(email, { color })

// Forgets the account on this device (its stored emails: forgetAccountMail in mailAlerts.ts).
// Its access isn't revoked at Google: Google would revoke
// SyncR's whole access for that Google account, so a Calendar sign-in with the same account
// would stop too. It can be removed by hand in the Google account (Security → Third-party
// access).
export function removeAccount(email: string) {
  saveAccounts(loadAccounts().filter((a) => a.email !== email))
}

// The accounts, kept current when they change (Settings, sign-in; also from the other window,
// e.g. the pop-up following a color change)
export function useGmailAccounts() {
  const [accounts, setAccounts] = useState(loadAccounts)
  useEffect(() => {
    const refresh = () => setAccounts(loadAccounts())
    const onOtherWindow = (e: Event) => (e as CustomEvent).detail === GMAIL_SECRET && refresh()
    window.addEventListener('gmail-change', refresh)
    window.addEventListener('secret-change', onOtherWindow) // secrets.ts
    return () => {
      window.removeEventListener('gmail-change', refresh)
      window.removeEventListener('secret-change', onOtherWindow)
    }
  }, [])
  return accounts
}

// ---------- Sign in ----------

type Result = { ok: boolean; text: string }

export const isGmailReturn = () => new URL(location.href).searchParams.get('state') === STATE

// Opens Google's sign-in page, where the user picks the account to add (or one already added:
// it's signed in again). PC app: the page opens in the normal browser and this waits for its
// return. Browser (only for testing, see SettingsDialog): leaves the app; finishGmailConnect()
// completes it on return. pubsub: also asks for the Pub/Sub permission (instant mail).
export async function connectGmail(pubsub = false): Promise<Result | null> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)))
  localStorage.setItem(VERIFIER_KEY, verifier)
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    scope: `${SCOPE} openid email${pubsub ? ` ${PUBSUB_SCOPE}` : ''}`, // email: which account it is
    state: STATE,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
    redirect_uri: redirectUri(),
    access_type: 'offline', // gives a refresh token, so no re-login
    prompt: 'select_account consent', // always asks which account; consent: see google.ts
  })
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  if (!isTauri()) {
    location.href = url
    return null
  }
  const query = await invoke<string>('google_sign_in', { url })
  return finish(new URLSearchParams(query))
}

// Call once at startup (browser). If we just came back from Google, finish the sign-in.
export async function finishGmailConnect(): Promise<Result | null> {
  if (!isGmailReturn()) return null
  const params = new URL(location.href).searchParams
  history.replaceState(null, '', appAddress()) // removes ?code=… from the address bar
  return finish(params)
}

async function finish(params: URLSearchParams): Promise<Result> {
  const fail = (text: string) => ({ ok: false, text })
  const code = params.get('code')
  const error = params.get('error')
  const granted = params.get('scope') ?? ''
  const verifier = localStorage.getItem(VERIFIER_KEY)
  localStorage.removeItem(VERIFIER_KEY)
  if (error) return fail(error === 'access_denied' ? 'Gmail: sign-in cancelled.' : `Gmail: ${error}`)
  if (!verifier || !code) return fail('Gmail sign-in expired. Please try again.')
  // Google's consent page lets the user untick the Gmail permission
  if (!granted.split(' ').includes(SCOPE)) {
    return fail('Gmail: SyncR needs the permission to read your emails. Add the account again and keep it ticked.')
  }
  const res = await tokenRequest({ code, code_verifier: verifier, redirect_uri: redirectUri() })
  if (!res.ok) return fail(`Gmail sign-in failed (${res.status}): ${await res.text()}`)
  const data = await res.json()
  const email = idTokenClaims(data.id_token).email
  if (!email) return fail('Gmail: Google didn’t say which account it is. Please try again.')

  const tokens = {
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    pubsub: granted.split(' ').includes(PUBSUB_SCOPE),
  }
  const accounts = loadAccounts()
  const existing = accounts.find((a) => a.email === email)
  if (existing) {
    // Already added: new tokens, keeps its color and on/off
    saveAccounts(accounts.map((a) => (a.email === email ? { ...a, ...tokens, expired: false } : a)))
    // The new tokens only carry what this sign-in asked for (Add account…: no Pub/Sub)
    if (existing.pubsub && !tokens.pubsub) {
      return { ok: false, text: `${email} signed in again, without the Pub/Sub permission: instant mail is off until "Sign in…" under Instant mail.` }
    }
    return { ok: true, text: `${email} signed in again.` }
  }
  saveAccounts([...accounts, { email, ...tokens, color: nextColor(accounts), enabled: true }])
  return { ok: true, text: `${email} added.` }
}

// Account colors, in the order new accounts get them (calm ones first; red looks urgent)
const ACCOUNT_COLORS = ['blue', 'green', 'purple', 'orange', 'pink', 'yellow', 'red', 'gray']

// A new account's color: the first one no account has yet (then they repeat)
function nextColor(accounts: GmailAccount[]) {
  const used = new Set(accounts.map((a) => a.color))
  return ACCOUNT_COLORS.find((c) => !used.has(c)) ?? ACCOUNT_COLORS[accounts.length % ACCOUNT_COLORS.length]
}

// ---------- Calls ----------

const REQUEST_TIMEOUT_MS = 30_000

// A valid access token for the account (they last 1 hour), renewed through the proxy when
// (almost) expired. Google refusing the sign-in marks the account "signed out" (Settings).
async function accessToken(email: string) {
  const account = loadAccounts().find((a) => a.email === email)
  if (!account || account.expired) throw new Error(`Gmail: ${email} isn't signed in`)
  if (account.accessToken && account.expiresAt && account.expiresAt > Date.now() + 60_000) {
    return account.accessToken
  }
  const res = await tokenRequest({ refresh_token: account.refreshToken })
  if (!res.ok) {
    // Only "invalid_grant" means the sign-in was revoked; other errors may pass
    if ((await res.text()).includes('invalid_grant')) {
      updateAccount(email, { expired: true, accessToken: undefined })
      throw new Error(`Gmail: ${email} was signed out. Sign in again in Settings.`)
    }
    throw new Error(`Gmail error (${res.status})`)
  }
  const data = await res.json()
  updateAccount(email, { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 })
  return data.access_token as string
}

// Calls the Gmail API for an account (JSON in, JSON out), e.g. gmailApi(email, 'messages').
export const gmailApi = (email: string, path: string, init: RequestInit = {}) =>
  googleApi(email, `https://gmail.googleapis.com/gmail/v1/users/me/${path}`, init, { name: `Gmail ${path}` })

// Calls a Google API with an account's sign-in (JSON in, JSON out): Gmail, Pub/Sub. If Google
// rejects the access token, gets a fresh one and tries once more. Errors carry the HTTP status.
export async function googleApi(
  email: string,
  url: string,
  init: RequestInit = {},
  { name, timeoutMs = REQUEST_TIMEOUT_MS }: { name: string; timeoutMs?: number },
) {
  const send = async () =>
    fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${await accessToken(email)}`,
      },
    })
  let res = await send()
  if (res.status === 401) {
    updateAccount(email, { accessToken: undefined })
    res = await send()
  }
  if (!res.ok) {
    let reason = await res.text()
    try {
      reason = JSON.parse(reason).error?.message ?? reason // Google's errors: { error: { message } }
    } catch {
      // not JSON: the text as it is
    }
    throw Object.assign(new Error(`${name} failed (${res.status}): ${reason}`), { status: res.status })
  }
  const text = await res.text()
  return text ? JSON.parse(text) : null
}
