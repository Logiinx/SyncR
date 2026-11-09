// Dropbox sign-in (OAuth 2 with PKCE, no secret, no server).
// The App key is public by design. The sign-in is remembered per device (secrets.ts: encrypted
// on the PC).

import { DROPBOX_SECRET, getSecret, setSecret } from './secrets'
import { forgetRemoteListing } from './db'
import { t } from './i18n'
import { base64Url, challengeFor, isOwnSignInState, newSignInState, returnKind } from './signIn'

const APP_KEY = '5600l0im00ni2so' // i18n-ok
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
  const timeout = new DOMException(t('Dropbox is not answering'), 'TimeoutError')
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
    entry.controller.abort(new DOMException('Dropbox request cancelled', 'AbortError')) // i18n-ok
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
  // Another account, or none: the saved file list of the old one no longer applies (sync.ts)
  if (auth?.refreshToken !== loadAuth()?.refreshToken) {
    forgetRemoteListing().catch((e) => console.warn('Could not forget the Dropbox file list', e))
  }
  void setSecret(DROPBOX_SECRET, auth ? JSON.stringify(auth) : null)
  window.dispatchEvent(new Event('dropbox-change'))
}

export function isConnected() {
  return loadAuth() !== null
}

export function connectedName() {
  return loadAuth()?.name
}

// ---------- Sign in / out ----------

// Leaves the app and opens the Dropbox sign-in page. Dropbox comes back with ?state=dropbox-…&code=…
export async function connect() {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)))
  localStorage.setItem(VERIFIER_KEY, verifier)
  const params = new URLSearchParams({
    client_id: APP_KEY,
    response_type: 'code',
    state: newSignInState('dropbox'),
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
    redirect_uri: redirectUri(),
    token_access_type: 'offline', // gives a refresh token, so no re-login
  })
  location.href = `https://www.dropbox.com/oauth2/authorize?${params}`
}

// True right after coming back from the Dropbox sign-in page. Also with no state at all: a
// sign-in started before v0.38.9 (it fails as expired).
export function isDropboxReturn() {
  const params = new URL(location.href).searchParams
  if (params.has('state')) return returnKind() === 'dropbox'
  return params.has('code') || params.has('error')
}

// Call once at startup. If we just came back from Dropbox, finish the sign-in.
// Returns why the sign-in failed, if it did (shown after "Dropbox sign-in failed: ", SyncButton.tsx).
export async function finishConnect(): Promise<string | null> {
  if (!isDropboxReturn()) return null
  const url = new URL(location.href)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error_description') ?? url.searchParams.get('error')

  // Remove ?code=… from the address bar
  history.replaceState(null, '', redirectUri())
  const verifier = localStorage.getItem(VERIFIER_KEY)
  localStorage.removeItem(VERIFIER_KEY)

  const ownState = isOwnSignInState('dropbox', url.searchParams.get('state'))

  if (error) return error // Dropbox's own words
  // Not the latest sign-in started here (an older tab, or a link from someone else)
  if (!verifier || !ownState) return t('it expired')

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
  if (!res.ok) return t('Dropbox answered {status}', { status: res.status })
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
  if (!auth) throw new Error(t('Not connected to Dropbox'))
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
      throw new Error(t('Dropbox sign-in expired. Please connect again.'))
    }
    throw new Error(t('Dropbox error ({status})', { status: res.status }))
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
      { method: 'POST', headers: { ...headers, Authorization: `Bearer ${await accessToken()}` }, body }, // i18n-ok
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
  if (!res.ok) throw new Error(t('Dropbox {endpoint} failed ({status}): {details}', { endpoint, status: res.status, details: await res.text() }))
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
  if (!res.ok) throw new Error(t('Dropbox download failed ({status})', { status: res.status }))
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
  if (!res.ok) throw new Error(t('Dropbox upload failed ({status})', { status: res.status }))
  const rev: string = (await res.json()).rev
  ownWrites.set(path.toLowerCase(), rev)
  return rev
}

export interface FileInfo {
  path: string // lower case, e.g. "/notes/1234-…"
  rev: string
  modified: number // when it was last written to Dropbox, ms since epoch
}

// The files in these folders, and a cursor for the whole app folder, for waitForChanges().
// The cursor is taken first, so a change made during the listing is still reported (at worst
// one extra sync). Not one listing of everything: the history/ folder (older versions of notes,
// noteHistory.ts) would make every sync download thousands of names.
export async function listFiles(folders: string[]): Promise<{ files: FileInfo[]; cursor: string }> {
  const { cursor } = await api('files/list_folder/get_latest_cursor', { path: '', recursive: true })
  const lists = await Promise.all(folders.map((folder) => listFolder(folder)))
  return { files: lists.flat(), cursor }
}

// The files in a folder (recursive: in its subfolders too). A missing folder has none.
export async function listFolder(path: string, recursive = false): Promise<FileInfo[]> {
  const files: FileInfo[] = []
  let page
  try {
    page = await api('files/list_folder', { path, recursive })
  } catch (e) {
    if (String(e).includes('not_found')) return files
    throw e
  }
  for (;;) {
    for (const entry of page.entries) {
      if (entry['.tag'] === 'file') {
        files.push({ path: entry.path_lower, rev: entry.rev, modified: Date.parse(entry.server_modified) })
      }
    }
    if (!page.has_more) return files
    page = await api('files/list_folder/continue', { cursor: page.cursor })
  }
}

// Deletes many files in one go (Dropbox's batch: one write instead of one per file). Files
// already gone are fine. Dropbox may take a moment: then it's asked every second until it's done.
export async function deleteFiles(paths: string[]) {
  for (let i = 0; i < paths.length; i += 1000) {
    const entries = paths.slice(i, i + 1000).map((path) => ({ path }))
    let answer = await oneWriteAtATime(() => api('files/delete_batch', { entries }))
    const job = answer.async_job_id
    for (let tries = 0; answer['.tag'] === 'async_job_id' || answer['.tag'] === 'in_progress'; tries++) {
      if (tries >= 120) throw new Error('Dropbox delete_batch took too long') // i18n-ok: only logged
      await new Promise((resolve) => setTimeout(resolve, 1000))
      answer = await api('files/delete_batch/check', { async_job_id: job })
    }
    if (answer['.tag'] !== 'complete') throw new Error(`Dropbox delete_batch failed: ${JSON.stringify(answer)}`) // i18n-ok: only logged
    for (const { path } of entries) ownWrites.set(path.toLowerCase(), null)
  }
}

// A change after a cursor. rev = null: the file was deleted (then modified = 0).
export interface Change {
  path: string
  rev: string | null
  modified: number
}

// What changed in the app folder after the cursor, and a new cursor for this moment.
// Folders are left out. A cursor Dropbox no longer knows throws an error (isCursorReset).
export async function changesSince(cursor: string) {
  const changes: Change[] = []
  for (;;) {
    const page = await api('files/list_folder/continue', { cursor })
    for (const entry of page.entries) {
      if (entry['.tag'] === 'file') changes.push({ path: entry.path_lower, rev: entry.rev, modified: Date.parse(entry.server_modified) })
      if (entry['.tag'] === 'deleted') changes.push({ path: entry.path_lower, rev: null, modified: 0 })
    }
    cursor = page.cursor
    if (!page.has_more) return { changes, cursor }
  }
}

// Dropbox forgot the cursor (it does now and then): the whole listing is needed again
export const isCursorReset = (error: unknown) => /"reset"|reset\//.test(String(error))

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
  if (!res.ok) throw new Error(t('Dropbox longpoll failed ({status})', { status: res.status }))
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
