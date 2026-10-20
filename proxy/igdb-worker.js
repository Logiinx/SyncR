// SyncR's IGDB proxy: a Cloudflare Worker between the app and the IGDB API (game data).
// IGDB can't be called from a web page directly: it sends no CORS headers, and it needs a
// Client Secret, which can't be in the app (public code). This Worker holds the secret,
// gets the Twitch access token, forwards the app's query and adds the CORS headers.
// It also does Google Calendar's sign-in exchange, for the same reason (see /google/token).
//
// Settings (Cloudflare dashboard → the Worker → Settings → Variables and Secrets, type Secret):
//   TWITCH_CLIENT_ID      from dev.twitch.tv/console (your application)
//   TWITCH_CLIENT_SECRET  same place ("New Secret")
//   PROXY_PASSWORD        any long random text; typed once in SyncR's Settings on each device,
//                         so only your SyncR can use this Worker (and your IGDB quota)
//   GOOGLE_CLIENT_SECRET  console.cloud.google.com → Google Auth Platform → Clients → SyncR
//
// The app sends: POST https://<worker>/<endpoint>, header "X-SyncR-Password", body = an IGDB
// query (Apicalypse), e.g. 'search "Guild Wars"; fields name; limit 5;'.

const ALLOWED_ORIGINS = [
  'https://logiinx.github.io', // phone app
  'https://tauri.localhost', // desktop app
  'http://localhost:5173', // development
  'http://localhost:4173', // local phone-version preview
]

// Only what SyncR needs (read-only data)
const ALLOWED_ENDPOINTS = new Set([
  'games',
  'covers',
  'release_dates',
  'platforms',
  'popularity_primitives',
  'popularity_types',
])

// The Twitch token lives ~2 months; kept in memory while this Worker instance runs
let token = null // { value, expires }

async function getToken(env, renew = false) {
  if (!renew && token && token.expires > Date.now() + 60_000) return token.value
  const params = new URLSearchParams({
    client_id: env.TWITCH_CLIENT_ID,
    client_secret: env.TWITCH_CLIENT_SECRET,
    grant_type: 'client_credentials',
  })
  const response = await fetch(`https://id.twitch.tv/oauth2/token?${params}`, { method: 'POST' })
  if (!response.ok) throw new Error(`Twitch token: ${response.status}`)
  const data = await response.json()
  token = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 }
  return token.value
}

// Google's "Web application" client for SyncR (not secret: it's also in the app)
const GOOGLE_CLIENT_ID = '563825863957-5652bv9llkma5mp1ipll2hc9kt1ouc3o.apps.googleusercontent.com'

// Google sign-in: Google only gives a lasting sign-in (refresh token) to a Web client when the
// request includes the client secret, so the app sends its request here and this adds it.
// Body (JSON), either { code, code_verifier, redirect_uri } right after sign-in, or
// { refresh_token } for a new 1-hour access token. Google's answer is passed back as it is;
// nothing is stored here.
async function googleToken(env, request) {
  const body = await request.json()
  const params = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET })
  if (body.refresh_token) {
    params.set('grant_type', 'refresh_token')
    params.set('refresh_token', body.refresh_token)
  } else {
    params.set('grant_type', 'authorization_code')
    params.set('code', body.code)
    params.set('code_verifier', body.code_verifier)
    params.set('redirect_uri', body.redirect_uri)
  }
  return fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: params })
}

function askIgdb(env, endpoint, query, accessToken) {
  return fetch(`https://api.igdb.com/v4/${endpoint}`, {
    method: 'POST',
    headers: {
      'Client-ID': env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
    body: query,
  })
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? ''
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-SyncR-Password',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    }
    const reply = (body, status) =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })

    // The browser asks first whether the real request is allowed (CORS preflight)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (request.method !== 'POST') return reply({ error: 'Use POST' }, 405)
    if (!env.PROXY_PASSWORD || request.headers.get('X-SyncR-Password') !== env.PROXY_PASSWORD) {
      return reply({ error: 'Wrong password' }, 401)
    }
    const endpoint = new URL(request.url).pathname.replace(/^\/+|\/+$/g, '')
    if (endpoint === 'google/token') {
      if (!env.GOOGLE_CLIENT_SECRET) return reply({ error: 'GOOGLE_CLIENT_SECRET is not set' }, 500)
      try {
        const response = await googleToken(env, request)
        return reply(await response.text(), response.status)
      } catch (error) {
        return reply({ error: String(error.message ?? error) }, 502)
      }
    }
    if (!ALLOWED_ENDPOINTS.has(endpoint)) return reply({ error: `Unknown endpoint: ${endpoint}` }, 404)

    try {
      const query = await request.text()
      let response = await askIgdb(env, endpoint, query, await getToken(env))
      // Token revoked or expired early: get a new one and try once more
      if (response.status === 401) response = await askIgdb(env, endpoint, query, await getToken(env, true))
      return reply(await response.text(), response.status)
    } catch (error) {
      return reply({ error: String(error.message ?? error) }, 502)
    }
  },
}
