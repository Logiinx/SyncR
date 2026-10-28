// Dropbox sign-in (OAuth 2 with PKCE, no secret, no server).
// The App key is public by design. The sign-in is remembered per device (secrets.ts: encrypted
// on the PC).

import { DROPBOX_SECRET, getSecret, setSecret } from './secrets'

const APP_KEY = '5600l0im00ni2so'
const VERIFIER_KEY = 'syncr.dropbox.verifier'

// A request that hangs longer than this fails, so a dead connection (e.g. after the PC slept)
// can't block sync for long. Files get 1 s more per 50 KB, for slow connections.
const REQUEST_TIMEOUT_MS = 15_000
const timeoutFor = (bytes: number) => REQUEST_TIMEOUT_MS + bytes / 50

// A request still waiting for Dropbox after this long when the user comes back is probably on
// a dead connection: cancelStuckRequests() ends it, and sync starts again.
const STUCK_MS = 5000

// Requests running now (not the longpoll, which waits for minutes on purpose)
const active = new Set<{ startedAt: number; controller: AbortController }>()

// Every Dropbox request goes through here (except the longpoll). The answer is read completely
// before the deadline, so a connection that dies halfway can't hang either.
async function request(url: string, init: RequestInit, bytes = 0) {
  const controller = new AbortController()
  const entry = { startedAt: Date.now(), controller }
  const timeout = new DOMException('Dropbox is not answering', 'TimeoutError')
  let timer = window.setTimeout(() => controller.abort(timeout), timeoutFor(bytes))
  active.add(entry)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    // A downloaded file: more time once Dropbox says how big it is
    const size = Number(res.headers.get('Content-Length'))
    if (size > bytes) {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => controller.abort(timeout), timeoutFor(size))
    }
    const body = await res.arrayBuffer()
    // (A response with "no content" can't be given a body, not even an empty one)
    const noContent = [204, 205, 304].includes(res.status)
    return new Response(noContent ? null : body, { status: res.status, statusText: res.statusText, headers: res.headers })
  } catch (e) {
    // Ended by us (timeout or cancelled): that reason, whatever error the browser gave
    throw controller.signal.aborted ? controller.signal.reason : e
  } finally {
    window.clearTimeout(timer)
    active.delete(entry)
  }
}

// Cancels requests that have been waiting for more than STUCK_MS (they fail with an AbortError).
// Returns true if there were any.
export function cancelStuckRequests() {
  let cancelled = false
  for (const entry of active) {
    if (Date.now() - entry.startedAt < STUCK_MS) continue
    entry.controller.abort(new DOMException('Dropbox request cancelled', 'AbortError'))
    active.delete(entry)
    cancelled = true
  }
  return cancelled
}

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
    return JSON.parse(getSecret(DROPBOX_SECRET) ?? 'null')
  } catch {
    return null
  }
}

function saveAuth(auth: Auth | null) {
  void setSecret(DROPBOX_SECRET, auth ? JSON.stringify(auth) : null)
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
  // Google Calendar's or a Gmail account's sign-in (google.ts, gmail.ts)
  if (['google', 'gmail'].includes(url.searchParams.get('state') ?? '')) return null
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error_description') ?? url.searchParams.get('error')
  if (!code && !error) return null

  // Remove ?code=… from the address bar
  history.replaceState(null, '', redirectUri())
  const verifier = localStorage.getItem(VERIFIER_KEY)
  localStorage.removeItem(VERIFIER_KEY)

  if (error) return `Dropbox: ${error}`
  if (!verifier) return 'Dropbox sign-in expired. Please try again.'

  const res = await request('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
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
  const res = await request('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: auth.refreshToken,
      client_id: APP_KEY,
    }),
  })
  if (!res.ok) {
    // The sign-in was revoked (e.g. from the Dropbox website): only "invalid_grant" means that.
    // Other errors (also 400s) may pass: keep the sign-in, sync tries again later.
    if ((await res.text()).includes('invalid_grant')) {
      saveAuth(null)
      throw new Error('Dropbox sign-in expired. Please connect again.')
    }
    throw new Error(`Dropbox error (${res.status})`)
  }
  const data = await res.json()
  saveAuth({ ...auth, accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 })
  return data.access_token as string
}

// A POST to Dropbox with the sign-in. If Dropbox rejects the access token (it can end a
// session before the token's expiry), gets a fresh one and tries once more. "Too many requests"
// (e.g. the other device writing at the same moment): waits as long as Dropbox asks, up to 3 times.
async function authorizedPost(url: string, headers: Record<string, string>, body?: Uint8Array<ArrayBuffer> | string) {
  const send = async () =>
    request(
      url,
      { method: 'POST', headers: { ...headers, Authorization: `Bearer ${await accessToken()}` }, body },
      typeof body === 'string' ? 0 : (body?.byteLength ?? 0),
    )
  let res = await send()
  for (let tries = 0; res.status === 429 && tries < 3; tries++) {
    const wait = await retryAfterMs(res)
    await new Promise((resolve) => window.setTimeout(resolve, wait))
    res = await send()
  }
  if (res.status !== 401) return res
  const auth = loadAuth()
  if (auth) saveAuth({ refreshToken: auth.refreshToken, name: auth.name }) // forget the access token
  return send()
}

// How long Dropbox asks to wait after "too many requests" (header or answer), 1 to 10 s
async function retryAfterMs(res: Response) {
  let seconds = Number(res.headers.get('Retry-After'))
  if (!seconds) {
    try {
      seconds = Number((await res.clone().json()).error?.retry_after)
    } catch {
      // not JSON
    }
  }
  return Math.min(Math.max(seconds || 1, 1), 10) * 1000
}

// Dropbox handles writes to a folder one at a time and refuses some when several arrive at
// once. Sync runs downloads side by side (sync.ts), so uploads and deletions queue up here.
let writeQueue: Promise<unknown> = Promise.resolve()

function oneWriteAtATime<T>(write: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(write)
  writeQueue = result.catch(() => {})
  return result
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

// What this device wrote to Dropbox (lower-case path -> new rev, null = deleted). Sync clears it
// when it starts, and afterwards tells its own changes from the other device's (sync.ts).
export const ownWrites = new Map<string, string | null>()

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
  const res = await oneWriteAtATime(() =>
    authorizedPost(
      'https://content.dropboxapi.com/2/files/upload',
      {
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({ path, mode: dropboxMode, autorename: false, mute: true }),
      },
      data,
    ),
  )
  if (res.status === 409 && mode !== 'overwrite' && (await res.text()).includes('conflict')) return null
  if (!res.ok) throw new Error(`Dropbox upload failed (${res.status})`)
  const rev: string = (await res.json()).rev
  ownWrites.set(path.toLowerCase(), rev)
  return rev
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

// What changed in the app folder after the cursor, and a new cursor for this moment.
// rev = null: the file was deleted. Folders are left out.
export async function changesSince(cursor: string) {
  const changes: { path: string; rev: string | null }[] = []
  for (;;) {
    const page = await api('files/list_folder/continue', { cursor })
    for (const entry of page.entries) {
      if (entry['.tag'] === 'file') changes.push({ path: entry.path_lower, rev: entry.rev })
      if (entry['.tag'] === 'deleted') changes.push({ path: entry.path_lower, rev: null })
    }
    cursor = page.cursor
    if (!page.has_more) return { changes, cursor }
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
    await oneWriteAtATime(() => api('files/delete_v2', rev ? { path, parent_rev: rev } : { path }))
    ownWrites.set(path.toLowerCase(), null)
    return true
  } catch (e) {
    if (!rev) {
      if (!String(e).includes('not_found')) throw e
      return true
    }
    const current = await fileRev(path)
    if (current === null) return true // gone anyway (a deletion we didn't make: not in ownWrites)
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
