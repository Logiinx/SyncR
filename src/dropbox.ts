// Dropbox sign-in (OAuth 2 with PKCE, no secret, no server).
// The App key is public by design. The sign-in is remembered per device in localStorage.

const APP_KEY = '5600l0im00ni2so'
const AUTH_KEY = 'syncr.dropbox'
const VERIFIER_KEY = 'syncr.dropbox.verifier'

// A request that hangs longer than this fails, so it can't block sync forever
const REQUEST_TIMEOUT_MS = 30_000

interface Auth {
  refreshToken: string
  accessToken?: string
  expiresAt?: number // ms since epoch
  name?: string // shown in the menu, e.g. "Connected as …"
}

// Where Dropbox sends the user back. Must match a Redirect URI in the Dropbox app settings:
// http://localhost:5173/, https://tauri.localhost/, https://logiinx.github.io/SyncR/
function redirectUri() {
  return new URL(import.meta.env.BASE_URL, location.origin).href
}

function loadAuth(): Auth | null {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY) ?? 'null')
  } catch {
    return null
  }
}

function saveAuth(auth: Auth | null) {
  if (auth) localStorage.setItem(AUTH_KEY, JSON.stringify(auth))
  else localStorage.removeItem(AUTH_KEY)
  window.dispatchEvent(new Event('dropbox-change'))
}

export function isConnected() {
  return loadAuth() !== null
}

export function connectedName() {
  return loadAuth()?.name
}

// ---------- PKCE helpers ----------

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

// Leaves the app and opens the Dropbox sign-in page. Dropbox comes back with ?code=…
export async function connect() {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)))
  localStorage.setItem(VERIFIER_KEY, verifier)
  const params = new URLSearchParams({
    client_id: APP_KEY,
    response_type: 'code',
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
    redirect_uri: redirectUri(),
    token_access_type: 'offline', // gives a refresh token, so no re-login
  })
  location.href = `https://www.dropbox.com/oauth2/authorize?${params}`
}

// Call once at startup. If we just came back from Dropbox, finish the sign-in.
// Returns an error message if the sign-in failed.
export async function finishConnect(): Promise<string | null> {
  const url = new URL(location.href)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error_description') ?? url.searchParams.get('error')
  if (!code && !error) return null

  // Remove ?code=… from the address bar
  history.replaceState(null, '', redirectUri())
  const verifier = localStorage.getItem(VERIFIER_KEY)
  localStorage.removeItem(VERIFIER_KEY)

  if (error) return `Dropbox: ${error}`
  if (!verifier) return 'Dropbox sign-in expired. Please try again.'

  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code!,
      client_id: APP_KEY,
      code_verifier: verifier,
      redirect_uri: redirectUri(),
    }),
  })
  if (!res.ok) return `Dropbox sign-in failed (${res.status}).`
  const data = await res.json()
  saveAuth({
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  })

  // Remember who is connected, for the menu. Not essential, so errors are ignored.
  try {
    const account = await api('users/get_current_account')
    const auth = loadAuth()
    if (auth) saveAuth({ ...auth, name: account.email ?? account.name?.display_name })
  } catch {
    // ignore
  }
  return null
}

export async function disconnect() {
  try {
    await api('auth/token/revoke')
  } catch {
    // Offline or already revoked: forget it locally anyway
  }
  saveAuth(null)
}

// ---------- Calls ----------

// A valid access token, refreshed when it is (almost) expired.
async function accessToken() {
  const auth = loadAuth()
  if (!auth) throw new Error('Not connected to Dropbox')
  if (auth.accessToken && auth.expiresAt && auth.expiresAt > Date.now() + 60_000) {
    return auth.accessToken
  }
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: auth.refreshToken,
      client_id: APP_KEY,
    }),
  })
  if (res.status === 400 || res.status === 401) {
    // The sign-in was revoked (e.g. from the Dropbox website)
    saveAuth(null)
    throw new Error('Dropbox sign-in expired. Please connect again.')
  }
  if (!res.ok) throw new Error(`Dropbox error (${res.status})`)
  const data = await res.json()
  saveAuth({ ...auth, accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 })
  return data.access_token as string
}

// A POST to Dropbox with the sign-in. If Dropbox rejects the access token (it can end a
// session before the token's expiry), gets a fresh one and tries once more.
async function authorizedPost(url: string, headers: Record<string, string>, body?: BodyInit) {
  const send = async () =>
    fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { ...headers, Authorization: `Bearer ${await accessToken()}` },
      body,
    })
  const res = await send()
  if (res.status !== 401) return res
  const auth = loadAuth()
  if (auth) saveAuth({ refreshToken: auth.refreshToken, name: auth.name }) // forget the access token
  return send()
}

// Calls a Dropbox API endpoint (JSON in, JSON out), e.g. api('users/get_current_account').
export async function api(endpoint: string, args?: unknown) {
  const res = await authorizedPost(
    `https://api.dropboxapi.com/2/${endpoint}`,
    args !== undefined ? { 'Content-Type': 'application/json' } : {},
    args !== undefined ? JSON.stringify(args) : undefined,
  )
  if (!res.ok) throw new Error(`Dropbox ${endpoint} failed (${res.status}): ${await res.text()}`)
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

// ---------- Files (paths are inside the app folder, e.g. "/crypto.json") ----------

// Returns the file's bytes, or null if it doesn't exist.
export async function download(path: string): Promise<Uint8Array | null> {
  const res = await authorizedPost('https://content.dropboxapi.com/2/files/download', {
    'Dropbox-API-Arg': JSON.stringify({ path }),
  })
  if (res.status === 409 && (await res.text()).includes('not_found')) return null
  if (!res.ok) throw new Error(`Dropbox download failed (${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}

// Returns the new version ("rev") of the file, or null if Dropbox refused because of the mode:
// "add" = only if the file doesn't exist yet, { update: rev } = only if it's still at that version,
// "overwrite" = always.
export async function upload(
  path: string,
  data: Uint8Array<ArrayBuffer>,
  mode: 'add' | 'overwrite' | { update: string },
): Promise<string | null> {
  const dropboxMode = typeof mode === 'string' ? mode : { '.tag': 'update', update: mode.update }
  const res = await authorizedPost(
    'https://content.dropboxapi.com/2/files/upload',
    {
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({ path, mode: dropboxMode, autorename: false, mute: true }),
    },
    data,
  )
  if (res.status === 409 && mode !== 'overwrite' && (await res.text()).includes('conflict')) return null
  if (!res.ok) throw new Error(`Dropbox upload failed (${res.status})`)
  return (await res.json()).rev
}

export interface FileInfo {
  path: string // lower case, e.g. "/notes/1234-…"
  rev: string
  modified: number // when it was last written to Dropbox, ms since epoch
}

// All files in the app folder, including subfolders. The cursor marks this moment,
// for waitForChanges().
export async function listFiles(): Promise<{ files: FileInfo[]; cursor: string }> {
  const files: FileInfo[] = []
  let page = await api('files/list_folder', { path: '', recursive: true })
  for (;;) {
    for (const entry of page.entries) {
      if (entry['.tag'] === 'file') {
        files.push({ path: entry.path_lower, rev: entry.rev, modified: Date.parse(entry.server_modified) })
      }
    }
    if (!page.has_more) return { files, cursor: page.cursor }
    page = await api('files/list_folder/continue', { cursor: page.cursor })
  }
}

// Waits (up to 8 minutes) until something changes in the app folder after the cursor.
// Returns true if something changed. "backoff": seconds to wait before calling again.
export async function waitForChanges(cursor: string, signal: AbortSignal) {
  const res = await fetch('https://notify.dropboxapi.com/2/files/list_folder/longpoll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cursor, timeout: 480 }),
    // Dropbox answers within 8 minutes (+ up to 90 s random delay); fail if it doesn't
    signal: AbortSignal.any([signal, AbortSignal.timeout(600_000)]),
  })
  if (!res.ok) throw new Error(`Dropbox longpoll failed (${res.status})`)
  const data = await res.json()
  return { changes: data.changes as boolean, backoff: (data.backoff as number | undefined) ?? 0 }
}

// Deleting a file that's already gone is fine (returns true).
// With rev: only if the file is still at that version. Returns false if it changed meanwhile
// (another device saved it). Dropbox doesn't document which error that gives, so on an error
// we look at the file itself.
export async function deleteFile(path: string, rev?: string): Promise<boolean> {
  try {
    await api('files/delete_v2', rev ? { path, parent_rev: rev } : { path })
    return true
  } catch (e) {
    if (!rev) {
      if (!String(e).includes('not_found')) throw e
      return true
    }
    const current = await fileRev(path)
    if (current === null) return true // gone anyway
    if (current !== rev) return false
    throw e // still the same version: a real error
  }
}

// The file's current version, or null if it doesn't exist
async function fileRev(path: string): Promise<string | null> {
  try {
    return (await api('files/get_metadata', { path })).rev
  } catch (e) {
    if (String(e).includes('not_found')) return null
    throw e
  }
}
