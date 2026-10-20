import { invoke, isTauri } from '@tauri-apps/api/core'
import { db } from './db'
import { igdbProxyFetch } from './igdb'

// Google Calendar sign-in (OAuth 2 with PKCE). Google only gives a lasting sign-in (refresh
// token) to a web app when the request includes the client secret, which can't be in the app
// (public code): the token requests go through SyncR's proxy (proxy/igdb-worker.js,
// /google/token), which adds it. The client id is public by design.
// The sign-in is remembered per device in localStorage (not synced).

const CLIENT_ID = '563825863957-5652bv9llkma5mp1ipll2hc9kt1ouc3o.apps.googleusercontent.com'
const SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const AUTH_KEY = 'syncr.google'
const VERIFIER_KEY = 'syncr.google.verifier'
const STATE = 'google' // tells Google's return apart from Dropbox's (both come back with ?code=…)

const REQUEST_TIMEOUT_MS = 30_000

interface Auth {
  refreshToken: string
  accessToken?: string
  expiresAt?: number // ms since epoch
  name?: string // the Google profile's name (or the main calendar's name: the account's email)
}

// The app's own address: http://localhost:5173/, http://localhost:4173/SyncR/,
// https://logiinx.github.io/SyncR/
const appAddress = () => new URL(import.meta.env.BASE_URL, location.origin).href

// Where Google sends the user back; must be a redirect URI of the client in Google Cloud. The
// app's own address, except in the PC app: there the sign-in runs in the normal browser, and
// SyncR listens for the return on this address (src-tauri/src/lib.rs, google_sign_in).
const PC_ADDRESS = 'http://localhost:47615/'
const redirectUri = () => (isTauri() ? PC_ADDRESS : appAddress())

function loadAuth(): Auth | null {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY) ?? 'null')
  } catch {
    return null
  }
}

function saveAuth(auth: Auth | null) {
  if (auth) localStorage.setItem(AUTH_KEY, JSON.stringify(auth))
  else {
    localStorage.removeItem(AUTH_KEY)
    db.events.clear() // signed out: the stored events go too (calendarEvents.ts)
  }
  window.dispatchEvent(new Event('google-change'))
}

export const isConnected = () => loadAuth() !== null
export const connectedName = () => loadAuth()?.name

// True right after coming back from Google's sign-in page (Dropbox's sign-in leaves this alone)
export const isGoogleReturn = () => new URL(location.href).searchParams.get('state') === STATE

// ---------- PKCE helpers (like dropbox.ts) ----------

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function challengeFor(verifier: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(hash))
}

// ---------- Sign in / out ----------

type Result = { ok: boolean; text: string }

// Opens Google's sign-in page. Google comes back with ?state=google&code=…
// Phone/browser: leaves the app (finishConnect() completes it on return; returns null).
// PC app: the page opens in the normal browser and this waits for its return (lib.rs), then
// completes the sign-in and returns the result.
export async function connect(): Promise<Result | null> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)))
  localStorage.setItem(VERIFIER_KEY, verifier)
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    scope: `${SCOPE} openid profile`, // profile: the name shown in Settings ("Connected as …")
    state: STATE,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
    redirect_uri: redirectUri(),
    access_type: 'offline', // gives a refresh token, so no re-login
    prompt: 'consent', // without it, Google sends the refresh token only the very first time
  })
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  if (!isTauri()) {
    location.href = url
    return null
  }
  const query = await invoke<string>('google_sign_in', { url })
  return finish(new URLSearchParams(query))
}

// Asks Google for tokens through the proxy (it adds the client secret)
async function tokenRequest(body: Record<string, string>) {
  return igdbProxyFetch('google/token', JSON.stringify(body), REQUEST_TIMEOUT_MS)
}

// Call once at startup. If we just came back from Google, finish the sign-in.
// Returns null if there was nothing to do, otherwise a message for the user (ok: it worked).
export async function finishConnect(): Promise<Result | null> {
  if (!isGoogleReturn()) return null
  const params = new URL(location.href).searchParams
  history.replaceState(null, '', appAddress()) // removes ?code=… from the address bar
  return finish(params)
}

// Google's answer (what came after "?"): gets the tokens
async function finish(params: URLSearchParams): Promise<Result> {
  const fail = (text: string) => ({ ok: false, text })
  const code = params.get('code')
  const error = params.get('error')
  const granted = params.get('scope') ?? ''
  const verifier = localStorage.getItem(VERIFIER_KEY)
  localStorage.removeItem(VERIFIER_KEY)

  if (error) return fail(error === 'access_denied' ? 'Google Calendar: sign-in cancelled.' : `Google Calendar: ${error}`)
  if (!verifier || !code) return fail('Google Calendar sign-in expired. Please try again.')
  // Google's consent page lets the user untick the calendar permission
  if (!granted.split(' ').includes(SCOPE)) {
    return fail('Google Calendar: SyncR needs the calendar permission. Connect again and keep it ticked.')
  }

  const res = await tokenRequest({ code, code_verifier: verifier, redirect_uri: redirectUri() })
  if (!res.ok) return fail(`Google Calendar sign-in failed (${res.status}): ${await res.text()}`)
  const data = await res.json()
  saveAuth({
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    name: profileName(data.id_token),
  })

  // No profile name (the user unticked it): the calendar's name (the account's email) instead.
  // Not essential, so errors are ignored.
  if (!loadAuth()?.name) {
    try {
      const list = await calendarApi('calendars/primary/events?maxResults=1')
      const auth = loadAuth()
      if (auth) saveAuth({ ...auth, name: list.summary })
    } catch {
      // ignore
    }
  }
  return { ok: true, text: 'Google Calendar connected.' }
}

// The Google profile's name, from the "ID token" Google sends with the "profile" permission.
// It's a signed JSON; its middle part (base64url) holds the name. Not checking the signature
// is fine: it came straight from Google (through our proxy) and only labels Settings.
function profileName(idToken?: string): string | undefined {
  try {
    const base64 = idToken!.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes)).name || undefined // UTF-8, e.g. accents
  } catch {
    return undefined
  }
}

export async function disconnect() {
  const auth = loadAuth()
  try {
    if (auth) {
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body: new URLSearchParams({ token: auth.refreshToken }),
      })
    }
  } catch {
    // Offline or already revoked: forget it locally anyway
  }
  saveAuth(null)
}

// ---------- Calls ----------

// A valid access token (they last 1 hour), renewed through the proxy when (almost) expired.
async function accessToken() {
  const auth = loadAuth()
  if (!auth) throw new Error('Not connected to Google Calendar')
  if (auth.accessToken && auth.expiresAt && auth.expiresAt > Date.now() + 60_000) {
    return auth.accessToken
  }
  const res = await tokenRequest({ refresh_token: auth.refreshToken })
  if (!res.ok) {
    // The sign-in was revoked (e.g. in the Google account's settings): only "invalid_grant"
    // means that. Other errors may pass: keep the sign-in, try again later.
    if ((await res.text()).includes('invalid_grant')) {
      saveAuth(null)
      throw new Error('Google Calendar sign-in expired. Please connect again.')
    }
    throw new Error(`Google Calendar error (${res.status})`)
  }
  const data = await res.json()
  saveAuth({ ...auth, accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 })
  return data.access_token as string
}

// Calls the Calendar API (JSON in, JSON out), e.g. calendarApi('calendars/primary/events').
// If Google rejects the access token, gets a fresh one and tries once more.
export async function calendarApi(path: string, init: RequestInit = {}) {
  const send = async () =>
    fetch(`https://www.googleapis.com/calendar/v3/${path}`, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${await accessToken()}`,
      },
    })
  let res = await send()
  if (res.status === 401) {
    const auth = loadAuth()
    if (auth) saveAuth({ refreshToken: auth.refreshToken, name: auth.name }) // forget the access token
    res = await send()
  }
  if (!res.ok) throw new Error(`Google Calendar ${path} failed (${res.status}): ${await res.text()}`)
  const text = await res.text()
  return text ? JSON.parse(text) : null
}
