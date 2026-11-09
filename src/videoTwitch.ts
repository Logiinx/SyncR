import { db, type VideoFollow, type VideoGame, type VideoRow } from './db'
import { t } from './i18n'

// The Video tab's requests to Twitch's website: the games played in past streams.
// Twitch's official list of a channel's videos has no games. Its website's data has them, with
// every game change, so the app asks for it directly (like the own Twitch player), with the
// public id of Twitch's website.

const TWITCH_SITE_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko' // i18n-ok
const GAME_PAGES = 3 // 100 videos a page: Twitch keeps past streams 7 to 60 days

async function askTwitchSite<T>(query: string): Promise<T> {
  const response = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Client-ID': TWITCH_SITE_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(20_000),
  })
  const answer = await response.json().catch(() => null)
  if (!response.ok || !answer?.data) throw new Error(t('Twitch answered {status}', { status: response.status }))
  return answer.data
}

interface SiteGame {
  name: string
  displayName: string
}
interface SiteVideos {
  user: { videos: { pageInfo: { hasNextPage: boolean }; edges: { cursor: string; node: { id: string; game: SiteGame | null; moments: { edges: { node: { details: { game?: SiteGame } | null } }[] } | null } }[] } } | null
}

// Fills in the games of this follow's videos that don't have them yet: a page of 100 at a time,
// newest first, until none is missing. A problem leaves them for the next check. Those Twitch
// doesn't list anymore (deleted, or older than the pages read) get none, so they aren't looked for
// at every check. Only the games are written: the rows may have changed during the wait (New
// taken off by the tab).
export async function addTwitchGames(follow: VideoFollow) {
  const missing = new Set(
    (await db.videos.filter((video) => video.platform === 'twitch' && video.channelId === follow.channelId && !video.games).primaryKeys()) as string[],
  )
  const saveGames = (found: { key: string; changes: Partial<VideoRow> }[]) => (found.length ? db.videos.bulkUpdate(found) : 0)
  let cursor = ''
  for (let page = 0; page < GAME_PAGES && missing.size; page++) {
    const game = 'name displayName' // i18n-ok
    const data = await askTwitchSite<SiteVideos>(
      // i18n-ok
      `{ user(id: ${JSON.stringify(follow.channelId)}) { videos(first: 100, type: ARCHIVE${cursor ? `, after: ${JSON.stringify(cursor)}` : ''}) { pageInfo { hasNextPage } edges { cursor node { id game { ${game} } moments(first: 100, types: [GAME_CHANGE], momentRequestType: VIDEO_CHAPTER_MARKERS) { edges { node { details { ... on GameChangeMomentDetails { game { ${game} } } } } } } } } } } }`,
    )
    const videos = data.user?.videos
    if (!videos) return
    const found: { key: string; changes: Partial<VideoRow> }[] = []
    for (const { node } of videos.edges) {
      const id = `twitch-${node.id}`
      if (!missing.has(id)) continue
      const games = new Map<string, VideoGame>()
      for (const game of [node.game, ...(node.moments?.edges ?? []).map((edge) => edge.node.details?.game)]) {
        if (game?.name && !games.has(game.name)) games.set(game.name, { name: game.name, shown: game.displayName || game.name })
      }
      found.push({ key: id, changes: { games: [...games.values()] } })
      missing.delete(id)
    }
    await saveGames(found)
    if (!videos.pageInfo.hasNextPage || !videos.edges.length) break
    cursor = videos.edges[videos.edges.length - 1].cursor
  }
  await saveGames([...missing].map((key) => ({ key, changes: { games: [] } })))
}

// Suggestions while typing a game for a follow: the games this channel played, newest first,
// then Twitch's matches for the text
export async function channelGames(channelId: string) {
  const rows = await db.videos.filter((video) => video.platform === 'twitch' && video.channelId === channelId).toArray()
  rows.sort((a, b) => b.published - a.published)
  return [...new Set(rows.flatMap((row) => (row.games ?? []).map((game) => game.shown)))]
}

export async function searchTwitchGames(text: string): Promise<string[]> {
  const data = await askTwitchSite<{ searchCategories: { edges: { node: { displayName: string } }[] } | null }>(
    `{ searchCategories(query: ${JSON.stringify(text)}, first: 8) { edges { node { displayName } } } }`,
  )
  return (data.searchCategories?.edges ?? []).map((edge) => edge.node.displayName)
}
