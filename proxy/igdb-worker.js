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
//   FRIEND_PASSWORD       optional: a second password for someone else's SyncR; game search
//                         and Google sign-in work, game prices don't (your GG.deals limit)
//   GOOGLE_CLIENT_SECRET  console.cloud.google.com → Google Auth Platform → Clients → SyncR
//   GGDEALS_KEY           gg.deals → Settings → API key (game prices, see /prices)
//   STEAM_KEY             steamcommunity.com/dev/apikey (your Steam games and achievements,
//                         see /steam/…; your profile's "Game details" must be public)
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

// Game prices in euros, for up to 100 Steam games ("apps") and 20 Steam packages ("subs",
// e.g. editions sold as a bundle). Body (JSON): { steamIds: [570, 1091500], subIds: [13435] }.
// Steam's own price (with its discount) and GG.deals' cheapest prices on official stores and
// key shops, with the all-time lows. Answer: { "<appId>": { steam, deals }, "sub<subId>": … },
// each null if unknown.
const askJson = (url) =>
  fetch(url)
    .then((response) => (response.ok ? response.json() : {}))
    .catch(() => ({}))

const askDeals = (env, kind, ids) =>
  env.GGDEALS_KEY && ids.length > 0
    ? askJson(`https://api.gg.deals/v1/prices/by-steam-${kind}-id/?ids=${ids.join(',')}&region=fr&key=${env.GGDEALS_KEY}`)
    : {}

const cleanIds = (ids, max) => (Array.isArray(ids) ? ids : []).map(Number).filter((id) => id > 0).slice(0, max)

function priceEntry(price, game) {
  return {
    // Prices in cents; a free game has no price
    steam: price ? { final: price.final, initial: price.initial, discount: price.discount_percent } : null,
    deals: game
      ? {
          url: game.url,
          retail: game.prices.currentRetail,
          keyshops: game.prices.currentKeyshops,
          retailLow: game.prices.historicalRetail,
          keyshopsLow: game.prices.historicalKeyshops,
        }
      : null,
  }
}

async function gamePrices(env, request) {
  const body = await request.json()
  const apps = cleanIds(body.steamIds, 100)
  const subs = cleanIds(body.subIds, 20)
  const [steamApps, steamSubs, dealsApps, dealsSubs] = await Promise.all([
    apps.length > 0
      ? askJson(`https://store.steampowered.com/api/appdetails?appids=${apps.join(',')}&cc=fr&filters=price_overview`)
      : {},
    // Steam answers one package per request
    Promise.all(subs.map((id) => askJson(`https://store.steampowered.com/api/packagedetails?packageids=${id}&cc=fr`))),
    askDeals(env, 'app', apps),
    askDeals(env, 'sub', subs),
  ])
  const result = {}
  for (const id of apps) result[id] = priceEntry(steamApps[id]?.data?.price_overview, dealsApps.data?.[id])
  subs.forEach((id, i) => {
    result[`sub${id}`] = priceEntry(steamSubs[i]?.[id]?.data?.price, dealsSubs.data?.[id])
  })
  return result
}

// ---------- Steam (owner only) ----------
// Body (JSON):
//   steam/profile       { profile } → { steamId, name, games }: games = how many it owns, null
//                       when the profile's game details are private
//   steam/owned         { steamId } → { games: [{ appId, name, minutes }] } (minutes played),
//                       or { private: true }
//   steam/achievements  { steamId, appIds } → { "<appId>": { done, total } }, null for a game
//                       without achievements. At most 40 games per request (a Worker may make
//                       50 requests of its own per request).
// profile: a profile link (…/profiles/7656… or …/id/name), or the number, or the custom name.
const STEAM_API = 'https://api.steampowered.com'

async function findSteamId(env, profile) {
  const text = String(profile ?? '').trim()
  const number = text.match(/(?:^|profiles\/)(\d{17})(?:\/|$)/)
  if (number) return number[1]
  const name = text.match(/\/id\/([^/?#]+)/)?.[1] ?? (/^[\w-]+$/.test(text) ? text : null)
  if (!name) return null
  const answer = await askJson(`${STEAM_API}/ISteamUser/ResolveVanityURL/v1/?key=${env.STEAM_KEY}&vanityurl=${encodeURIComponent(name)}`)
  return answer.response?.success === 1 ? answer.response.steamid : null
}

async function ownedGames(env, steamId) {
  const answer = await askJson(
    `${STEAM_API}/IPlayerService/GetOwnedGames/v1/?key=${env.STEAM_KEY}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1`,
  )
  const games = answer.response?.games
  return Array.isArray(games) ? games.map((g) => ({ appId: g.appid, name: g.name, minutes: g.playtime_forever ?? 0 })) : null
}

async function steam(env, endpoint, request) {
  const body = await request.json()
  if (endpoint === 'steam/profile') {
    const steamId = await findSteamId(env, body.profile)
    if (!steamId) return { error: 'Steam profile not found' }
    const [summary, games] = await Promise.all([
      askJson(`${STEAM_API}/ISteamUser/GetPlayerSummaries/v2/?key=${env.STEAM_KEY}&steamids=${steamId}`),
      ownedGames(env, steamId),
    ])
    return { steamId, name: summary.response?.players?.[0]?.personaname ?? null, games: games ? games.length : null }
  }
  const steamId = String(body.steamId ?? '')
  if (!/^\d{17}$/.test(steamId)) return { error: 'No Steam id' }
  if (endpoint === 'steam/owned') {
    const games = await ownedGames(env, steamId)
    return games ? { games } : { private: true }
  }
  const apps = cleanIds(body.appIds, 40)
  const answers = await Promise.all(
    apps.map((appId) =>
      askJson(`${STEAM_API}/ISteamUserStats/GetPlayerAchievements/v1/?key=${env.STEAM_KEY}&steamid=${steamId}&appid=${appId}`),
    ),
  )
  const result = {}
  apps.forEach((appId, i) => {
    const list = answers[i].playerstats?.achievements
    result[appId] = Array.isArray(list) && list.length > 0
      ? { done: list.filter((a) => a.achieved === 1).length, total: list.length }
      : null
  })
  return result
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
    // Owner: everything. Friend (optional): everything but prices, so they can't use up the
    // owner's GG.deals limit.
    const password = request.headers.get('X-SyncR-Password')
    const owner = !!env.PROXY_PASSWORD && password === env.PROXY_PASSWORD
    const friend = !!env.FRIEND_PASSWORD && password === env.FRIEND_PASSWORD
    if (!owner && !friend) return reply({ error: 'Wrong password' }, 401)
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
    if (endpoint === 'prices') {
      if (!owner) return reply({}, 200) // the app then just shows no prices
      try {
        return reply(await gamePrices(env, request), 200)
      } catch (error) {
        return reply({ error: String(error.message ?? error) }, 502)
      }
    }
    if (['steam/profile', 'steam/owned', 'steam/achievements'].includes(endpoint)) {
      if (!owner) return reply({ error: 'Steam is only for the owner of this proxy' }, 403)
      if (!env.STEAM_KEY) return reply({ error: 'STEAM_KEY is not set' }, 500)
      try {
        return reply(await steam(env, endpoint, request), 200)
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
