// SyncR's IGDB proxy: a Cloudflare Worker between the app and the IGDB API (game data).
// IGDB can't be called from a web page directly: it sends no CORS headers, and it needs a
// Client Secret, which can't be in the app (public code). This Worker holds the secret,
// gets the Twitch access token, forwards the app's query and adds the CORS headers.
// It also does Google Calendar's sign-in exchange, for the same reason (see /google/token),
// and reads web pages for the link cards in notes (see /preview).
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
//   GITHUB_TOKEN          optional: github.com → Settings → Developer settings → Fine-grained
//                         tokens, "Public repositories", no permissions. Link cards of GitHub
//                         repos: 5,000 lookups per hour instead of 60 (see /preview)
//   YOUTUBE_KEY           optional: shows the Video tab in your SyncR (not for the friend
//                         password; see video/ below). console.cloud.google.com → APIs &
//                         Services → enable "YouTube Data API v3" → Credentials → API key
//                         (restrict it to that API)
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

// Game prices in euros, for up to 100 Steam games ("apps"), 20 Steam packages ("subs", e.g.
// editions) and 100 Steam bundles (GG.deals' prices only, see below). Body (JSON):
// { steamIds: [570, 1091500], subIds: [13435], bundleIds: [32470] }.
// Steam's own price (with its discount) and GG.deals' cheapest prices on official stores and
// key shops, with the all-time lows, and the product's name (so the app can tell when IGDB linked
// the wrong Steam page). Answer: { "<appId>": { name, steam, deals }, "sub<subId>": …,
// "bundle<bundleId>": …, _rate:
// GG.deals' limit counters (see askDeals) }, each
// null if unknown.
const askJson = (url) =>
  fetch(url)
    .then((response) => (response.ok ? response.json() : {}))
    .catch(() => ({}))

// GG.deals' answer, with its limit counters from the answer's headers (x-ratelimit-limit,
// -remaining, -reset, as GG.deals sends them; limited: over the limit, no data), so the app can pace
// its price checks
async function askDeals(env, kind, ids) {
  if (!env.GGDEALS_KEY || ids.length === 0) return {}
  try {
    const response = await fetch(`https://api.gg.deals/v1/prices/by-steam-${kind}-id/?ids=${ids.join(',')}&region=fr&key=${env.GGDEALS_KEY}`)
    const header = (name) => response.headers.get(`x-ratelimit-${name}`)
    const rate = { limit: header('limit'), remaining: header('remaining'), reset: header('reset'), limited: response.status === 429 }
    return { ...(response.ok ? await response.json() : {}), rate }
  } catch {
    return {}
  }
}

const cleanIds = (ids, max) => (Array.isArray(ids) ? ids : []).map(Number).filter((id) => id > 0).slice(0, max)

function priceEntry(price, game, name) {
  return {
    name: game?.title ?? name ?? null,
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
  const bundles = cleanIds(body.bundleIds, 100)
  const [steamApps, steamSubs, dealsApps, dealsSubs, dealsBundles] = await Promise.all([
    apps.length > 0
      ? askJson(`https://store.steampowered.com/api/appdetails?appids=${apps.join(',')}&cc=fr&filters=price_overview`)
      : {},
    // Steam answers one package per request
    Promise.all(subs.map((id) => askJson(`https://store.steampowered.com/api/packagedetails?packageids=${id}&cc=fr`))),
    askDeals(env, 'app', apps),
    askDeals(env, 'sub', subs),
    askDeals(env, 'bundle', bundles),
  ])
  const result = {}
  for (const id of apps) result[id] = priceEntry(steamApps[id]?.data?.price_overview, dealsApps.data?.[id])
  subs.forEach((id, i) => {
    const sub = steamSubs[i]?.[id]?.data
    result[`sub${id}`] = priceEntry(sub?.price, dealsSubs.data?.[id], sub?.name)
  })
  // Bundles: GG.deals only. Steam's own bundle lookup gives the full price without today's
  // discount; the app has the right one from /editions.
  for (const id of bundles) result[`bundle${id}`] = priceEntry(null, dealsBundles.data?.[id])
  // GG.deals' counters after this answer (of the asks, the one with fewer left). Not a
  // game: apps before v0.24.3 ignore it.
  const rates = [dealsApps.rate, dealsSubs.rate, dealsBundles.rate].filter(Boolean)
  if (rates.length > 0) {
    const fewest = rates.reduce((a, b) => (Number(b.remaining ?? Infinity) < Number(a.remaining ?? Infinity) ? b : a))
    result._rate = { ...fewest, limited: rates.some((r) => r.limited) }
  }
  return result
}

// A game's other editions on Steam: the purchase options of its store page, for up to 100 Steam
// games. Body (JSON): { steamIds: [1245620] }. Answer: { "<appId>": [{ kind, id, name, steam }] }:
// kind "sub" (a package) or "bundle" (several products sold together); GG.deals' prices for both
// via /prices. steam = price in cents like /prices. Steam lists the game
// itself first: left out, and so are options with other games in them. No key needed.
async function gameEditions(request) {
  const apps = cleanIds((await request.json()).steamIds, 100)
  if (apps.length === 0) return {}
  const input = {
    ids: apps.map((appid) => ({ appid })),
    context: { language: 'english', country_code: 'FR' },
    data_request: { include_all_purchase_options: true },
  }
  const answer = await askJson(`https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`)
  const result = {}
  for (const item of answer.response?.store_items ?? []) {
    // Options with other games in them ("Dead Space + Cronos", franchise bundles) aren't editions
    const options = (item.purchase_options ?? []).slice(1).filter((option) => (option.included_game_count ?? 1) <= 1)
    result[item.appid] = options.map((option) => ({
      kind: option.packageid ? 'sub' : 'bundle',
      id: Number(option.packageid ?? option.bundleid),
      name: option.purchase_option_name,
      steam: option.final_price_in_cents
        ? {
            final: Number(option.final_price_in_cents),
            initial: Number(option.original_price_in_cents ?? option.final_price_in_cents), // none without a discount
            discount: option.discount_pct ?? 0,
          }
        : null,
    }))
  }
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

// Like askJson, but a failure is an error (not "private" or "not found"). The message leaves
// out the URL: it holds the key.
async function askSteam(url) {
  const response = await fetch(url)
  if (response.status === 401 || response.status === 403) throw new Error('Steam refused the key (check STEAM_KEY)')
  if (!response.ok) throw new Error(`Steam didn't answer (${response.status})`)
  return response.json()
}

async function findSteamId(env, profile) {
  const text = String(profile ?? '').trim()
  const number = text.match(/(?:^|profiles\/)(\d{17})(?:\/|$)/)
  if (number) return number[1]
  const name = text.match(/\/id\/([^/?#]+)/)?.[1] ?? (/^[\w-]+$/.test(text) ? text : null)
  if (!name) return null
  const answer = await askSteam(`${STEAM_API}/ISteamUser/ResolveVanityURL/v1/?key=${env.STEAM_KEY}&vanityurl=${encodeURIComponent(name)}`)
  return answer.response?.success === 1 ? answer.response.steamid : null
}

async function ownedGames(env, steamId) {
  const answer = await askSteam(
    `${STEAM_API}/IPlayerService/GetOwnedGames/v1/?key=${env.STEAM_KEY}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1`,
  )
  // Private game details: an empty answer. No games: a count of 0, no list.
  if (answer.response?.game_count === 0) return []
  const games = answer.response?.games
  return Array.isArray(games) ? games.map((g) => ({ appId: g.appid, name: g.name, minutes: g.playtime_forever ?? 0 })) : null
}

async function steam(env, endpoint, request) {
  const body = await request.json()
  if (endpoint === 'steam/profile') {
    const steamId = await findSteamId(env, body.profile)
    if (!steamId) return { error: 'Steam profile not found' }
    const [summary, games] = await Promise.all([
      askSteam(`${STEAM_API}/ISteamUser/GetPlayerSummaries/v2/?key=${env.STEAM_KEY}&steamids=${steamId}`),
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

// ---------- Link previews ----------
// Body (JSON): { url } → what a note's link card shows: { url, kind, site, title, description,
// image, icon } (any of them may be null), plus for kind "github" { stars, language }, for
// kind "tweet" { author, handle, likes, date } and for kind "reddit" { author, score, comments };
// { error } when the page can't be read.
// GitHub repos come from GitHub's API, posts on X (x.com, twitter.com, fxtwitter.com…) from
// fxtwitter's API (X itself shows nothing to programs), Reddit from vxreddit (see
// redditPreview), other pages from their meta tags.
const PREVIEW_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; SyncR-LinkPreview/1.0)' }
const TWEET_HOSTS = ['x.com', 'twitter.com', 'fxtwitter.com', 'fixupx.com', 'vxtwitter.com', 'fixvx.com']
// GitHub's white logo (its usual one is black, unseen on SyncR's dark cards)
const GITHUB_ICON = 'https://github.githubassets.com/favicons/favicon-dark.png'

const hostOf = (url) => url.hostname.replace(/^(www|mobile)\./, '')

async function githubPreview(env, url) {
  const [owner, repo, more] = url.pathname.split('/').filter(Boolean)
  // Only a repo's main page; issues, files… use the page's meta tags
  if (!owner || !repo || more) return null
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: {
      ...PREVIEW_HEADERS,
      Accept: 'application/vnd.github+json',
      ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
    },
  })
  if (!response.ok) return null // e.g. over GitHub's limit: the page's meta tags instead
  const data = await response.json()
  return {
    url: url.href,
    kind: 'github',
    site: 'GitHub',
    title: data.full_name,
    description: data.description,
    image: data.owner?.avatar_url ?? null,
    icon: GITHUB_ICON,
    stars: data.stargazers_count ?? null,
    language: data.language ?? null,
  }
}

async function tweetPreview(url) {
  const match = url.pathname.match(/^\/([^/]+)\/status(?:es)?\/(\d+)/)
  if (!match) return null
  const response = await fetch(`https://api.fxtwitter.com/${match[1]}/status/${match[2]}`, { headers: PREVIEW_HEADERS })
  // A deleted or private post: no card (fxtwitter's own page would say "post doesn't exist")
  if (response.status === 404) return { error: 'Post not found' }
  if (!response.ok) return null
  const tweet = (await response.json()).tweet
  if (!tweet) return { error: 'Post not found' }
  const media = tweet.media ?? {}
  return {
    url: url.href,
    kind: 'tweet',
    site: 'X',
    title: tweet.author?.name ?? null,
    description: tweet.text ?? null,
    image: media.photos?.[0]?.url ?? media.videos?.[0]?.thumbnail_url ?? null,
    icon: tweet.author?.avatar_url ?? null,
    author: tweet.author?.name ?? null,
    handle: tweet.author?.screen_name ?? null,
    likes: tweet.likes ?? null,
    date: tweet.created_timestamp ? tweet.created_timestamp * 1000 : null,
  }
}

// Reddit shows programs on Cloudflare only a "Prove your humanity" page. vxreddit (like
// fxtwitter for X) reads posts for chat apps' link previews, so it's asked as one; Reddit's own
// embed answer (title, subreddit, author only) when that fails.
const REDDIT_ICON = 'https://www.redditstatic.com/shreddit/assets/favicon/64x64.png'
const VXREDDIT_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; SyncR-LinkPreview/1.0)', Accept: 'text/html' }
const isRedditHost = (host) => /(^|\.)reddit\.com$/.test(host) || ['redd.it', 'vxreddit.com', 'rxddit.com'].includes(host)

async function redditPreview(url) {
  let path = url.pathname
  if (hostOf(url) === 'redd.it') path = `/comments${path}` // redd.it/abc = post abc
  // A share link from the Reddit app (/r/x/s/abc) only forwards to the post
  if (/^\/r\/[^/]+\/s\/[^/]+/.test(path)) {
    const response = await fetch(`https://www.reddit.com${path}`, { headers: PREVIEW_HEADERS, redirect: 'manual' })
    const target = response.headers.get('Location')
    if (!target) return { error: `Reddit answered ${response.status}`, temporary: response.status !== 404 }
    path = new URL(target, 'https://www.reddit.com').pathname
  }
  const base = { url: url.href, kind: 'reddit', site: 'Reddit', description: null, image: null, icon: REDDIT_ICON }
  if (!/^\/(?:(?:r|u|user)\/[^/]+\/)?comments\/[a-z0-9]+/i.test(path)) {
    // Not a post: a subreddit or a user, named from the address
    const place = path.match(/^\/(r|u|user)\/([^/]+)/)
    return { ...base, title: place ? `${place[1] === 'r' ? 'r' : 'u'}/${decodeURIComponent(place[2])}` : 'Reddit' }
  }
  return (await vxredditPost(path, base)) ?? (await redditEmbed(path, base))
}

// vxreddit's page: og:site_name = "u/name on r/sub - ⬆️ 123 | 💬 45" (no comments count for a
// comment), the title in its oEmbed link, the post's text in og:description (unless og:title is
// "vxReddit": then og:description is the title), og:image the picture. Null when not readable.
async function vxredditPost(path, base) {
  const response = await fetch(`https://vxreddit.com${path}`, { headers: VXREDDIT_HEADERS, redirect: 'manual' }).catch(() => null)
  if (!response?.ok) return null
  const html = await response.text()
  const meta = metaTags(html)
  const about = (meta['og:site_name'] ?? '').match(/^u\/(\S+) on r\/(\S+)\s*-\s*\D*?(-?\d+)(?:\s*\|\s*\D*?(\d+))?/)
  if (!about) return null
  const oembed = (html.match(/<link\s[^>]*>/gi) ?? []).find((tag) => /json\+oembed/i.test(attribute(tag, 'type') ?? ''))
  const linkTitle = oembed ? attribute(oembed, 'title') : undefined
  const ownTitle = meta['og:title'] && meta['og:title'] !== 'vxReddit'
  const image = meta['og:image'] ?? meta['twitter:image'] ?? null
  // A post's text can be very long; cards show a few lines
  const text = ownTitle ? (meta['og:description'] ?? null) : null
  return {
    ...base,
    site: `r/${about[2]}`,
    title: linkTitle ? decodeHtml(linkTitle) : ownTitle ? meta['og:title'] : (meta['og:description'] ?? null),
    description: text && text.length > 300 ? `${text.slice(0, 300).trimEnd()}…` : text,
    image: image ? image.replace(/^http:/, 'https:') : null,
    author: `u/${about[1]}`,
    score: Number(about[3]),
    comments: about[4] !== undefined ? Number(about[4]) : null,
  }
}

// Reddit's embed answer (it lets Cloudflare in): title, author and subreddit, nothing more
async function redditEmbed(path, base) {
  const address = encodeURIComponent(`https://www.reddit.com${path}`)
  const response = await fetch(`https://www.reddit.com/oembed?url=${address}`, { headers: PREVIEW_HEADERS })
  if (response.status === 404) return { error: 'Post not found' }
  if (!response.ok) return { error: `Reddit answered ${response.status}`, temporary: true }
  const data = await response.json()
  const subreddit = (data.html ?? '').match(/reddit\.com\/r\/([^/"]+)\//)?.[1]
  return {
    ...base,
    site: subreddit ? `r/${subreddit}` : 'Reddit',
    title: data.title ?? null,
    author: data.author_name ? `u/${data.author_name}` : null,
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
// A number past Unicode's last character stays as written (fromCodePoint would throw)
const character = (all, code) => (code <= 0x10ffff ? String.fromCodePoint(code) : all)
const decodeHtml = (text) =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (all, hex) => character(all, parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (all, number) => character(all, Number(number)))
    .replace(/&([a-z]+);/gi, (all, name) => ENTITIES[name.toLowerCase()] ?? all)
    .replace(/\s+/g, ' ')
    .trim()

const attribute = (tag, name) => tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(2).find((v) => v !== undefined)

// A page's <meta> tags: { "og:title": "…", description: "…" } (the first of each name)
function metaTags(html) {
  const meta = {}
  for (const tag of html.match(/<meta\s[^>]*>/gi) ?? []) {
    const key = (attribute(tag, 'property') ?? attribute(tag, 'name') ?? '').toLowerCase()
    const content = attribute(tag, 'content')
    if (key && content !== undefined && !(key in meta)) meta[key] = decodeHtml(content)
  }
  return meta
}

// A page's title, description, picture and icon from its <head> (only the first 300 KB are read)
async function pagePreview(url) {
  const response = await fetch(url.href, { headers: { ...PREVIEW_HEADERS, Accept: 'text/html' }, redirect: 'follow' })
  // Too many requests, or the site is down for now: worth asking again later
  const temporary = response.status === 429 || response.status >= 500
  if (!response.ok) return { error: `The site answered ${response.status}`, temporary }
  if (!(response.headers.get('Content-Type') ?? '').includes('html')) return { error: 'Not a web page' }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let html = ''
  while (html.length < 300_000) {
    const { done, value } = await reader.read()
    if (done) break
    html += decoder.decode(value, { stream: true })
    if (html.includes('</head>')) break
  }
  reader.cancel().catch(() => {})
  const page = new URL(response.url || url.href)
  const meta = metaTags(html)
  const absolute = (address) => {
    try {
      const href = address ? new URL(address, page).href : null
      return href === 'data:,' ? null : href // "data:," = "no icon"
    } catch {
      return null
    }
  }
  const iconTag = (html.match(/<link\s[^>]*>/gi) ?? []).find((tag) => /(^|\s)icon(\s|$)/i.test(attribute(tag, 'rel') ?? ''))
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]
  return {
    url: url.href,
    kind: 'page',
    site: meta['og:site_name'] ?? hostOf(page),
    title: meta['og:title'] ?? meta['twitter:title'] ?? (title ? decodeHtml(title) : null),
    description: meta['og:description'] ?? meta['twitter:description'] ?? meta.description ?? null,
    image: absolute(meta['og:image'] ?? meta['twitter:image']),
    icon: absolute(iconTag ? attribute(iconTag, 'href') : '/favicon.ico'),
  }
}

async function linkPreview(env, request) {
  let url
  try {
    url = new URL((await request.json()).url)
  } catch {
    return { error: 'Not a link' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: 'Not a web link' }
  const host = hostOf(url)
  const special =
    host === 'github.com'
      ? await githubPreview(env, url)
      : TWEET_HOSTS.includes(host)
        ? await tweetPreview(url)
        : isRedditHost(host)
          ? await redditPreview(url)
          : null
  const preview = special ?? (await pagePreview(url))
  if (host === 'github.com' && !preview.error) preview.icon = GITHUB_ICON
  return preview
}

// Video tab: new videos of followed Twitch and YouTube channels. Only for the owner, and only
// when YOUTUBE_KEY is set (see the top of this file); otherwise the app shows no Video tab.
//   video/status   no body                  { enabled }
//   video/channel  { link }                 { platform, id, name, icon }
//   video/list     { platform, id, since, back, known }
//                                           { videos: [...], mark? }, newest first. "since" (a date):
//                                           everything back to it, and nothing older. "back" (a date):
//                                           reads back to it, gives all it read. Neither: the latest
//                                           page. YouTube's "mark" says what its uploads list holds, when
//                                           no video in it is still live: sending it back as "known"
//                                           gives { unchanged: true } if the list is the same, for 1
//                                           quota unit instead of 3.
//   video/exists   { platform, ids }        { existing: [...] }: the ones still there
//   video/one      { link }                 { platform, channel: { id, name, icon }, video }
const TWITCH_API = 'https://api.twitch.tv/helix'
const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3'
const VIDEO_PAGES = 10 // the most pages per list: Cloudflare allows 50 outside calls per request

// An answer the app should show as it is, not "try again later" (502)
const videoError = (message, status = 400) => Object.assign(new Error(message), { status })

// 404 = the channel or video is gone: not an error, there's just nothing to list
async function askTwitch(env, path) {
  const ask = async (renew) =>
    fetch(`${TWITCH_API}/${path}`, {
      headers: { 'Client-ID': env.TWITCH_CLIENT_ID, Authorization: `Bearer ${await getToken(env, renew)}` },
    })
  let response = await ask(false)
  if (response.status === 401) response = await ask(true)
  if (response.status === 404) return { data: [] }
  if (!response.ok) throw new Error(`Twitch: ${response.status}`)
  return response.json()
}

// Errors name only Google's reason (e.g. quotaExceeded), never the address: it holds the key
async function askYouTube(env, path, params) {
  const response = await fetch(`${YOUTUBE_API}/${path}?${new URLSearchParams({ ...params, key: env.YOUTUBE_KEY })}`)
  if (response.status === 404) return { items: [] }
  if (!response.ok) {
    const answer = await response.json().catch(() => null)
    throw new Error(`YouTube: ${answer?.error?.errors?.[0]?.reason ?? response.status}`)
  }
  return response.json()
}

// What a pasted link points to. Pages of a site that aren't channels are refused here, so they
// can't turn into a channel with that name.
const TWITCH_PAGES = new Set(['videos', 'directory', 'downloads', 'jobs', 'p', 'settings', 'subscriptions', 'turbo', 'wallet'])
const YOUTUBE_PAGES = new Set(['watch', 'playlist', 'shorts', 'live', 'embed', 'feed', 'results', 'hashtag', 'gaming', 'premium', 'account'])

function channelLink(text) {
  const typed = String(text ?? '').trim()
  let url
  try {
    url = new URL(/^https?:\/\//i.test(typed) ? typed : `https://${typed.startsWith('@') ? `youtube.com/${typed}` : typed}`)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '')
  const [first, second] = url.pathname.split('/').filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part)
    } catch {
      return part
    }
  })
  if (!first) return null
  if (host === 'twitch.tv') {
    const login = first.toLowerCase()
    return /^[a-z0-9_]{1,25}$/.test(login) && !TWITCH_PAGES.has(login) ? { platform: 'twitch', login } : null
  }
  if (host !== 'youtube.com') return null
  if (first.startsWith('@')) return { platform: 'youtube', lookups: [{ forHandle: first }] }
  if (first === 'channel') return second ? { platform: 'youtube', lookups: [{ id: second }] } : null
  if (first === 'user') return second ? { platform: 'youtube', lookups: [{ forUsername: second }] } : null
  // Old-style addresses: youtube.com/c/name and youtube.com/name
  const name = first === 'c' ? second : first
  if (!name || YOUTUBE_PAGES.has(first)) return null
  return { platform: 'youtube', lookups: [{ forHandle: `@${name}` }, { forUsername: name }] }
}

async function findChannel(env, link) {
  const found = channelLink(link)
  if (!found) throw videoError('not-a-channel')
  if (found.platform === 'twitch') {
    const user = (await askTwitch(env, `users?login=${found.login}`)).data?.[0]
    if (!user) throw videoError('channel-not-found', 404)
    return { platform: 'twitch', id: user.id, name: user.display_name, icon: user.profile_image_url || null }
  }
  for (const lookup of found.lookups) {
    const channel = (await askYouTube(env, 'channels', { part: 'snippet', ...lookup })).items?.[0]
    if (channel) return { platform: 'youtube', id: channel.id, name: channel.snippet.title, icon: channel.snippet.thumbnails?.default?.url ?? null }
  }
  throw videoError('channel-not-found', 404)
}

// "1h2m3s" (Twitch) and "PT1H2M3S" (YouTube, can start with days: "P1DT2H") in seconds
function seconds(text) {
  const part = (unit) => Number(String(text).match(new RegExp(`(\\d+)${unit}`, 'i'))?.[1] ?? 0)
  return part('d') * 86400 + part('h') * 3600 + part('m') * 60 + part('s')
}

// One video as the app gets it. live = still being streamed (or, on YouTube, announced): the app
// waits until it's finished. Twitch lists a stream in progress as a video too; only its stream's
// id tells them apart.
const twitchVideo = (video, liveStream) => ({
  id: video.id,
  kind: video.type, // archive (past stream), highlight or upload
  title: video.title,
  url: video.url,
  thumbnail: video.thumbnail_url ? video.thumbnail_url.replace('%{width}', '320').replace('%{height}', '180') : null,
  published: video.published_at,
  duration: seconds(video.duration),
  live: !!liveStream && video.stream_id === liveStream,
})

const youtubeVideo = (video, kind) => ({
  id: video.id,
  kind,
  title: video.snippet.title,
  url: `https://www.youtube.com/watch?v=${video.id}`,
  thumbnail: video.snippet.thumbnails?.medium?.url ?? null,
  published: video.snippet.publishedAt,
  duration: seconds(video.contentDetails.duration),
  live: video.snippet.liveBroadcastContent !== 'none',
})

async function twitchVideos(env, id, reach) {
  const liveStream = (await askTwitch(env, `streams?user_id=${id}&first=1`)).data?.[0]?.id
  const videos = []
  let cursor = ''
  for (let page = 0; page < VIDEO_PAGES; page++) {
    const answer = await askTwitch(env, `videos?user_id=${id}&first=100&type=all${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`)
    const items = answer.data ?? []
    videos.push(...items.map((video) => twitchVideo(video, liveStream)))
    cursor = answer.pagination?.cursor
    if (!reach || !cursor || !items.length || Date.parse(items[items.length - 1].published_at) < reach) break
  }
  return videos
}

// Stands for the videos on a list's first page: any upload, removal or change of order changes it
async function listMark(ids) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ids.join(',')))
  return [...new Uint8Array(hash)].slice(0, 12).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

// The ids in one of a channel's automatic playlists, newest first. Private videos have no date.
// A first page matching "known": nothing else to read.
async function playlistIds(env, playlist, reach, known) {
  const ids = []
  let mark
  let pageToken
  for (let page = 0; page < VIDEO_PAGES; page++) {
    const answer = await askYouTube(env, 'playlistItems', { part: 'contentDetails', playlistId: playlist, maxResults: '50', ...(pageToken ? { pageToken } : {}) })
    const items = answer.items ?? []
    ids.push(...items.map((item) => item.contentDetails.videoId))
    if (page === 0) {
      mark = await listMark(ids)
      if (mark === known) return { ids: [], mark, unchanged: true }
    }
    pageToken = answer.nextPageToken
    const oldest = items[items.length - 1]?.contentDetails.videoPublishedAt
    if (!reach || !pageToken || !items.length || (oldest && Date.parse(oldest) < reach)) break
  }
  return { ids, mark }
}

// A channel's id starts with UC. UU + the rest = its uploads (official); UUSH + the rest = only
// its Shorts (not official, but the API has no other way to tell them apart). Shorts are a part
// of the uploads, so the same page or period of them covers all that the uploads list holds.
async function youtubeVideos(env, id, reach, known) {
  const { ids, mark, unchanged } = await playlistIds(env, `UU${id.slice(2)}`, reach, known)
  if (unchanged) return { unchanged, mark }
  if (!ids.length) return { videos: [], mark }
  const shorts = new Set((await playlistIds(env, `UUSH${id.slice(2)}`, reach)).ids)
  const videos = []
  for (let start = 0; start < ids.length; start += 50) {
    const answer = await askYouTube(env, 'videos', { part: 'snippet,contentDetails', id: ids.slice(start, start + 50).join(','), maxResults: '50' })
    // Deleted and private videos just aren't in this answer
    videos.push(...(answer.items ?? []).map((video) => youtubeVideo(video, shorts.has(video.id) ? 'short' : 'video')))
  }
  // A live video will finish without changing the list, so no mark until then
  return videos.some((video) => video.live) ? { videos } : { videos, mark }
}

async function listVideos(env, { platform, id, since, back, known }) {
  const date = (text) => {
    const time = text ? Date.parse(text) : NaN
    return Number.isNaN(time) ? null : time
  }
  const limit = date(since)
  const reach = limit ?? date(back)
  let answer
  if (platform === 'twitch' && /^\d+$/.test(id)) answer = { videos: await twitchVideos(env, id, reach) }
  else if (platform === 'youtube' && /^UC[\w-]{22}$/.test(id)) answer = await youtubeVideos(env, id, reach, known)
  else throw videoError('Unknown channel')
  if (answer.unchanged) return answer
  return {
    ...answer,
    videos: answer.videos
      .filter((video) => limit === null || Date.parse(video.published) >= limit)
      .sort((a, b) => Date.parse(b.published) - Date.parse(a.published)),
  }
}

// Which of these videos can still be watched. Twitch deletes old streams; YouTube videos can
// be removed or made private.
async function existingVideos(env, { platform, ids }) {
  if (!Array.isArray(ids) || ids.length > 500) throw videoError('Up to 500 videos at a time')
  const twitch = platform === 'twitch'
  if (!twitch && platform !== 'youtube') throw videoError('Unknown channel')
  const valid = ids.filter((id) => typeof id === 'string' && (twitch ? /^\d+$/ : /^[\w-]{6,20}$/).test(id))
  const size = twitch ? 100 : 50
  const existing = []
  for (let start = 0; start < valid.length; start += size) {
    const part = valid.slice(start, start + size)
    const answer = twitch
      ? (await askTwitch(env, `videos?${part.map((id) => `id=${id}`).join('&')}&first=${size}`)).data
      : (await askYouTube(env, 'videos', { part: 'id', id: part.join(','), maxResults: String(size) })).items
    existing.push(...(answer ?? []).map((video) => video.id))
  }
  return { existing }
}

// The video a pasted link points to, or null
function videoLink(text) {
  const typed = String(text ?? '').trim()
  let url
  try {
    url = new URL(/^https?:\/\//i.test(typed) ? typed : `https://${typed}`)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, '')
  const parts = url.pathname.split('/').filter(Boolean)
  if (host === 'twitch.tv') {
    // twitch.tv/videos/123, and the older twitch.tv/name/video/123 and twitch.tv/name/v/123
    const id = parts[0] === 'videos' ? parts[1] : ['video', 'v'].includes(parts[1]) ? parts[2] : null
    return /^\d+$/.test(id ?? '') ? { platform: 'twitch', id } : null
  }
  let id = null
  if (host === 'youtu.be') id = parts[0]
  else if (host === 'youtube.com') id = parts[0] === 'watch' ? url.searchParams.get('v') : ['shorts', 'live', 'embed', 'v'].includes(parts[0]) ? parts[1] : null
  return /^[\w-]{6,20}$/.test(id ?? '') ? { platform: 'youtube', id } : null
}

async function oneTwitchVideo(env, id) {
  const video = (await askTwitch(env, `videos?id=${id}`)).data?.[0]
  if (!video) throw videoError('video-not-found', 404)
  const liveStream = (await askTwitch(env, `streams?user_id=${video.user_id}&first=1`)).data?.[0]?.id
  const user = (await askTwitch(env, `users?id=${video.user_id}`)).data?.[0]
  return {
    platform: 'twitch',
    channel: { id: video.user_id, name: user?.display_name ?? video.user_name, icon: user?.profile_image_url || null },
    video: twitchVideo(video, liveStream),
  }
}

async function oneYouTubeVideo(env, id) {
  // Deleted and private videos just aren't in this answer
  const video = (await askYouTube(env, 'videos', { part: 'snippet,contentDetails', id })).items?.[0]
  if (!video) throw videoError('video-not-found', 404)
  const channel = (await askYouTube(env, 'channels', { part: 'snippet', id: video.snippet.channelId })).items?.[0]
  return {
    platform: 'youtube',
    channel: { id: video.snippet.channelId, name: channel?.snippet.title ?? video.snippet.channelTitle, icon: channel?.snippet.thumbnails?.default?.url ?? null },
    video: youtubeVideo(video, 'video'),
  }
}

// One video, by its link. A channel's link gets its own answer, so the app can say what to do with
// it; a clip's link starts like one (twitch.tv/name/clip/…).
async function oneVideo(env, link) {
  const found = videoLink(link)
  if (!found) throw videoError(channelLink(link) && !/\/clip\//i.test(String(link)) ? 'channel-link' : 'not-a-video')
  const answer = await (found.platform === 'twitch' ? oneTwitchVideo(env, found.id) : oneYouTubeVideo(env, found.id))
  if (answer.video.live) throw videoError('video-live')
  return answer
}

async function videoFeed(env, endpoint, request) {
  const body = await request.json().catch(() => ({}))
  if (endpoint === 'video/channel') return findChannel(env, body.link)
  if (endpoint === 'video/list') return listVideos(env, body)
  if (endpoint === 'video/exists') return existingVideos(env, body)
  if (endpoint === 'video/one') return oneVideo(env, body.link)
  throw videoError(`Unknown endpoint: ${endpoint}`, 404)
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
    if (endpoint === 'prices' || endpoint === 'editions') {
      if (!owner) return reply({}, 200) // the app then just shows no prices
      try {
        return reply(endpoint === 'prices' ? await gamePrices(env, request) : await gameEditions(request), 200)
      } catch (error) {
        return reply({ error: String(error.message ?? error) }, 502)
      }
    }
    // A page that can't be read now (busy, down, unreachable): 502, so the app doesn't keep
    // "no card" for a day but asks again next time it starts
    if (endpoint === 'preview') {
      try {
        const { temporary, ...preview } = await linkPreview(env, request)
        return reply(preview, temporary ? 502 : 200)
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
    if (endpoint.startsWith('video/')) {
      const on = owner && !!env.YOUTUBE_KEY
      if (endpoint === 'video/status') return reply({ enabled: on }, 200)
      if (!on) return reply({ error: 'The video feed is off' }, 403)
      try {
        return reply(await videoFeed(env, endpoint, request), 200)
      } catch (error) {
        return reply({ error: String(error.message ?? error) }, error.status ?? 502)
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
