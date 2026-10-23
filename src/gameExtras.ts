import { useEffect, useState } from 'react'
import { igdb, isComplete, loadConnection } from './igdb'

// Extra details shown in the game windows (GameDialog.tsx, GameCalendar.tsx): developer,
// publisher, game modes and a trailer. Loaded from IGDB when a window opens and kept only until
// the app closes (user's choice: always up to date, nothing stored or synced).

export interface GameExtras {
  developers: string[]
  publishers: string[]
  modes: string[] // "Single player", "Co-operative"…
  trailer?: { id: string; name: string } // a YouTube video id
}

interface IgdbExtras {
  involved_companies?: { company?: { name: string }; developer: boolean; publisher: boolean }[]
  game_modes?: { name: string }[]
  videos?: { id: number; name?: string; video_id: string }[]
}

const MAX_COMPANIES = 3 // big games list many regional publishers

// The newest video with "trailer" in its name (IGDB ids grow over time), else the newest video
function pickTrailer(videos: IgdbExtras['videos'] = []) {
  const newestFirst = [...videos].sort((a, b) => b.id - a.id)
  const video = newestFirst.find((v) => /trailer/i.test(v.name ?? '')) ?? newestFirst[0]
  return video && { id: video.video_id, name: video.name || 'Trailer' }
}

async function fetchExtras(igdbId: number): Promise<GameExtras> {
  const [game] = await igdb<IgdbExtras>(
    'games',
    `fields involved_companies.company.name, involved_companies.developer, involved_companies.publisher, game_modes.name, videos.video_id, videos.name; where id = ${igdbId};`,
  )
  const companies = (role: 'developer' | 'publisher') =>
    (game?.involved_companies ?? [])
      .filter((c) => c[role] && c.company)
      .map((c) => c.company!.name)
      .slice(0, MAX_COMPANIES)
  return {
    developers: companies('developer'),
    publishers: companies('publisher'),
    modes: (game?.game_modes ?? []).map((m) => m.name),
    trailer: pickTrailer(game?.videos),
  }
}

const loaded = new Map<number, Promise<GameExtras>>() // this session only
const known = new Map<number, GameExtras>() // the answers already in, shown right away

function loadExtras(igdbId: number) {
  let extras = loaded.get(igdbId)
  if (!extras) {
    extras = fetchExtras(igdbId)
    extras.then((result) => known.set(igdbId, result), () => {})
    extras.catch(() => loaded.delete(igdbId)) // failed (offline…): try again next time
    loaded.set(igdbId, extras)
  }
  return extras
}

// undefined while loading, null when there's nothing to show (game search not set up, offline)
export function useGameExtras(igdbId: number): GameExtras | null | undefined {
  const [extras, setExtras] = useState<GameExtras | null | undefined>(() => known.get(igdbId))
  useEffect(() => {
    let current = true
    setExtras(known.get(igdbId))
    if (known.has(igdbId)) return
    loadConnection()
      .then((connection) => (isComplete(connection) ? loadExtras(igdbId) : null))
      .then((result) => current && setExtras(result))
      .catch(() => current && setExtras(null))
    return () => {
      current = false
    }
  }, [igdbId])
  return extras
}
