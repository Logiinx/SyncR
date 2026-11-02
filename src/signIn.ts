// Helpers shared by the sign-ins: Dropbox (dropbox.ts), Google Calendar (google.ts) and Gmail
// (gmail.ts). All three use OAuth 2 with PKCE and leave the app (or, on the PC, open the
// browser) and come back with ?state=…&code=…

export type SignInKind = 'dropbox' | 'google' | 'gmail' // google = Calendar

// ---------- State ----------

// The "state" sent with a sign-in: what it's for plus a random part, remembered until the
// return brings it back. The first part tells the returns apart. The random part shows that a
// return answers the sign-in started on this device, not a link someone else made.
export function newSignInState(kind: SignInKind) {
  const state = `${kind}-${base64Url(crypto.getRandomValues(new Uint8Array(16)))}`
  localStorage.setItem(`syncr.${kind}.state`, state)
  return state
}

// What the address's sign-in return is for, from its state, or null (no state). Also a plain
// "google"/"gmail": a Google sign-in started before v0.38.9 (it fails as expired). A Dropbox
// sign-in started before then comes back without a state: dropbox.ts handles that.
export const returnKind = () =>
  (new URL(location.href).searchParams.get('state')?.match(/^(dropbox|google|gmail)(-|$)/)?.[1] as SignInKind) ??
  null

// True if the return brings back the state this device sent. Works once: the state is forgotten.
export function isOwnSignInState(kind: SignInKind, state: string | null) {
  const key = `syncr.${kind}.state`
  const expected = localStorage.getItem(key)
  localStorage.removeItem(key)
  return !!expected && state === expected
}

// ---------- PKCE ----------

export function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export async function challengeFor(verifier: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(hash))
}
