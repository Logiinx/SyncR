import { invoke, isTauri } from '@tauri-apps/api/core'
import { t } from './i18n'
import { useEffect, useState } from 'react'
import { appAddress, CLIENT_ID, idTokenClaims, redirectUri, tokenRequest } from './google'
import { getSecret, GMAIL_SECRET, setSecret } from './secrets'
import { base64Url, challengeFor, isOwnSignInState, newSignInState, returnKind } from './signIn'

// Gmail accounts (PC: pop-ups for new mail). Each account has its own Google sign-in, apart
// from the Google Calendar one (google.ts): adding or removing a Gmail account never touches
// Reminders. Same client, proxy and PC sign-in as Calendar. Remembered per device, not synced
// (secrets.ts: encrypted on the PC).

const SCOPE = 'https://www.googleapis.com/auth/gmail.modify' // read, mark as read/unread
// Instant mail (instantMail.ts): reads Gmail's "new mail" signals from SyncR's Google Cloud queue
export const PUBSUB_SCOPE = 'https://www.googleapis.com/auth/pubsub'
const VERIFIER_KEY = 'syncr.gmail.verifier'

export interface GmailAccount {
  email: string
  refreshToken: string
  color: string // a palette name (var(--text-<name>)): the strip on its pop-up cards
  enabled: boolean // off: not checked for new mail
  expired?: boolean // Google refused the sign-in (e.g. access removed): sign in again
  pubsub?: boolean // signed in with the Pub/Sub permission: collects instant mail's signals
}

export function loadAccounts(): GmailAccount[] {
  try {
    // Up to v0.31 the access tokens were stored too: left out (they're in `accessTokens` now)
    const stored: (GmailAccount & { accessToken?: string; expiresAt?: number })[] = JSON.parse(getSecret(GMAIL_SECRET) ?? '[]')
    return stored.map(({ accessToken, expiresAt, ...account }) => account)
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

export const isGmailReturn = () => returnKind() === 'gmail'

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
    scope: `${SCOPE} openid email${pubsub ? ` ${PUBSUB_SCOPE}` : ''}`, // email: which account it is (i18n-ok)
    state: newSignInState('gmail'),
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
    redirect_uri: redirectUri(),
    access_type: 'offline', // gives a refresh token, so no re-login
    prompt: 'select_account consent', // always asks which account; consent: see google.ts (i18n-ok)
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
  const ownState = isOwnSignInState('gmail', params.get('state'))
  if (error) return fail(error === 'access_denied' ? t('Gmail: sign-in cancelled.') : t('Gmail: {error}', { error }))
  // Not the latest sign-in started here (an older tab, or a link from someone else)
  if (!verifier || !code || !ownState) return fail(t('Gmail sign-in expired. Please try again.'))
  // Google's consent page lets the user untick the Gmail permission
  if (!granted.split(' ').includes(SCOPE)) {
    return fail(t('Gmail: SyncR needs the permission to read your emails. Add the account again and keep it ticked.'))
  }
  const res = await tokenRequest({ code, code_verifier: verifier, redirect_uri: redirectUri() })
  if (!res.ok) return fail(t('Gmail sign-in failed ({status}): {details}', { status: res.status, details: await res.text() }))
  const data = await res.json()
  const email = idTokenClaims(data.id_token).email
  if (!email) return fail(t('Gmail: Google didn’t say which account it is. Please try again.'))

  accessTokens.set(email, { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 })
  const tokens = {
    refreshToken: data.refresh_token,
    pubsub: granted.split(' ').includes(PUBSUB_SCOPE),
  }
  const accounts = loadAccounts()
  const existing = accounts.find((a) => a.email === email)
  if (existing) {
    // Already added: new tokens, keeps its color and on/off
    saveAccounts(accounts.map((a) => (a.email === email ? { ...a, ...tokens, expired: false } : a)))
    // The new tokens only carry what this sign-in asked for (Add account…: no Pub/Sub)
    if (existing.pubsub && !tokens.pubsub) {
      return { ok: false, text: t('{email} signed in again, without the Pub/Sub permission: instant mail is off until "Sign in…" under Instant mail.', { email }) }
    }
    return { ok: true, text: t('{email} signed in again.', { email }) }
  }
  saveAccounts([...accounts, { email, ...tokens, color: nextColor(accounts), enabled: true }])
  return { ok: true, text: t('{email} added.', { email }) }
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

// Access tokens (they last 1 hour), per window and only in memory: saving them would make the
// pop-up rewrite the account list every hour, and a list saved by one window can undo a change
// the other just made (on the PC each window's copy catches up a moment late, secrets.ts).
const accessTokens = new Map<string, { token: string; expiresAt: number }>()

// A valid access token for the account, renewed through the proxy when (almost) expired.
// Google refusing the sign-in marks the account "signed out" (Settings).
async function accessToken(email: string) {
  const account = loadAccounts().find((a) => a.email === email)
  if (!account || account.expired) throw Object.assign(new Error(t("Gmail: {email} isn't signed in", { email })), { signedOut: true })
  const known = accessTokens.get(email)
  if (known && known.expiresAt > Date.now() + 60_000) return known.token
  const res = await tokenRequest({ refresh_token: account.refreshToken })
  if (!res.ok) {
    // Only "invalid_grant" means the sign-in was revoked; other errors may pass
    if ((await res.text()).includes('invalid_grant')) {
      accessTokens.delete(email)
      updateAccount(email, { expired: true })
      throw Object.assign(new Error(t('Gmail: {email} was signed out. Sign in again in Settings.', { email })), { signedOut: true })
    }
    throw Object.assign(new Error(t('Gmail sign-in renewal failed ({status})', { status: res.status })), { status: res.status })
  }
  const data = await res.json()
  accessTokens.set(email, { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 })
  return data.access_token as string
}

// A failed Gmail call in plain words, without a period (Mail tab, reader, attached files);
// Gmail's exact text stays in the error's message (shown on hover)
export function gmailErrorText(error: unknown) {
  const e = asGmailError(error)
  const status = e.status ?? 0
  if (e.signedOut) return t('Signed out, sign in again in Settings → Accounts')
  if (e.offline) return t('No connection to Gmail (offline?)')
  if (status === 404) return t('This email is gone (deleted or moved in Gmail)')
  if (isBusy(e)) return t('Gmail is busy right now')
  if (status) return t('Gmail error ({status})', { status })
  return error instanceof Error ? error.message : String(error)
}

// Whether trying again later can help: no connection, Gmail busy, or no answer from Gmail at
// all. Not when signed out, the email is gone, or Gmail refused the request.
export function gmailErrorPasses(error: unknown) {
  const e = asGmailError(error)
  return !e.signedOut && (!e.status || isBusy(e))
}

type GmailError = { status?: number; signedOut?: boolean; offline?: boolean; message?: string }
const asGmailError = (error: unknown) => (error ?? {}) as GmailError
// Too many requests at once, or trouble on Google's side
const isBusy = ({ status = 0, message = '' }: GmailError) =>
  status === 429 || status >= 500 || (status === 403 && /rate|limit/i.test(message))

// Its details for the hover text: Gmail's own words
export const errorDetails = (error: unknown) => (error instanceof Error ? error.message : String(error))

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
  const send = async () => {
    const token = await accessToken(email)
    try {
      return await fetch(url, {
        ...init,
        cache: 'no-store', // emails never kept in the browser's cache files (Google doesn't forbid it)
        signal: AbortSignal.timeout(timeoutMs),
        headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}` }, // i18n-ok
      })
    } catch (error) {
      // No answer at all (no network, timed out)
      throw Object.assign(new Error(`${name}: ${error}`), { offline: true })
    }
  }
  let res = await send()
  if (res.status === 401) {
    accessTokens.delete(email)
    res = await send()
  }
  if (!res.ok) {
    let reason = await res.text()
    try {
      reason = JSON.parse(reason).error?.message ?? reason // Google's errors: { error: { message } }
    } catch {
      // not JSON: the text as it is
    }
    throw Object.assign(new Error(t('{name} failed ({status}): {reason}', { name, status: res.status, reason })), { status: res.status })
  }
  const text = await res.text()
  return text ? JSON.parse(text) : null
}
