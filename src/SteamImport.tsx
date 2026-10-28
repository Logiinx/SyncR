import { useEffect, useRef, useState } from 'react'
import CloseButton from './CloseButton'
import Cover from './GameCover'
import Spinner from './Spinner'
import { db } from './db'
import { addGame } from './games'
import { gamesBySteamIds, type FoundGame } from './igdb'
import { loadSkipped, loadSteamProfile, ownedGames, playedText, saveSkipped, updateSteamStats } from './steam'

// "Import from Steam" (Library tab): your Steam games that aren't in SyncR yet, most played
// first, each matched to its IGDB game by its Steam id. Played 1 h or more: ticked. Games IGDB
// doesn't know can't be added. The ticked ones go to the Library; the others are remembered as
// skipped (steam.ts) and hidden next time, unless "Show skipped" is on.

const TICKED_FROM = 60 // minutes played

interface Row {
  appId: number
  name: string // IGDB's, else Steam's
  minutes: number
  game?: FoundGame
}

export default function SteamImport({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null) // null while loading
  const [error, setError] = useState<string | null>(null)
  const [skipped, setSkipped] = useState<Set<number>>(new Set())
  const [ticked, setTicked] = useState<Set<number>>(new Set())
  const [showSkipped, setShowSkipped] = useState(false)
  const [busy, setBusy] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => dialogRef.current?.focus({ preventScroll: true }), []) // so Escape works

  useEffect(() => {
    let current = true
    const load = async () => {
      try {
        const profile = await loadSteamProfile()
        const owned = profile.steamId ? await ownedGames(profile.steamId) : null
        if (!owned) throw new Error("Steam doesn't share your games: set Game details to Public (Steam → Profile → Privacy)")
        const [matches, skippedIds, inList] = await Promise.all([
          gamesBySteamIds(owned.map((g) => g.appId)),
          loadSkipped(),
          db.games.filter((g) => !g.deleted).toArray().then((games) => new Set(games.map((g) => g.igdbId))),
        ])
        const found = owned
          .map((g) => ({ appId: g.appId, name: matches.get(g.appId)?.name ?? g.name, minutes: g.minutes, game: matches.get(g.appId) }))
          .filter((row) => !(row.game && inList.has(row.game.igdbId)))
          .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name))
        if (!current) return
        setSkipped(new Set(skippedIds))
        setTicked(new Set(found.filter((r) => r.game && r.minutes >= TICKED_FROM && !skippedIds.includes(r.appId)).map((r) => r.appId)))
        setRows(found)
      } catch (e) {
        if (current) setError(e instanceof Error ? e.message : String(e))
      }
    }
    load()
    return () => {
      current = false
    }
  }, [])

  const shown = rows?.filter((r) => showSkipped || !skipped.has(r.appId)) ?? []
  const skippedCount = rows?.filter((r) => skipped.has(r.appId)).length ?? 0
  const chosen = shown.filter((r) => r.game && ticked.has(r.appId))

  const tick = (appId: number, on: boolean) => {
    const next = new Set(ticked)
    if (on) next.add(appId)
    else next.delete(appId)
    setTicked(next)
  }

  // Ticked → Library (once per IGDB game: two Steam ids can be one game); the shown unticked
  // ones are skipped from now on, a ticked skipped one isn't anymore
  async function confirm() {
    setBusy(true)
    const added = new Set<number>()
    try {
      for (const row of chosen) {
        if (added.has(row.game!.igdbId)) continue
        added.add(row.game!.igdbId)
        await addGame(row.game!, 'library')
      }
      const nextSkipped = new Set(skipped)
      for (const row of shown) {
        if (ticked.has(row.appId) && row.game) nextSkipped.delete(row.appId)
        else nextSkipped.add(row.appId)
      }
      await saveSkipped([...nextSkipped])
    } catch (e) {
      // Shown in place of the list; games already added stay (a new import skips them)
      setError(`Saving failed: ${e instanceof Error ? e.message : String(e)}`)
      setBusy(false)
      return
    }
    onClose()
    // Their hours and achievements, in the background
    const games = await db.games.filter((g) => added.has(g.igdbId) && !g.deleted).toArray()
    if (games.length > 0) updateSteamStats(games)
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        className="dialog steam-import"
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <div className="dialog-head">
          <h2>Import from Steam</h2>
          <CloseButton onClick={onClose} />
        </div>
        {error ? (
          <p className="steam-import-note">{error}</p>
        ) : !rows ? (
          <p className="steam-import-note">
            <Spinner size={14} /> Loading your Steam games…
          </p>
        ) : (
          <>
            <div className="steam-import-head">
              <span>
                {shown.length > 0
                  ? `${shown.length} not in SyncR yet`
                  : skippedCount > 0 ? 'Nothing new: the rest is skipped' : 'All your Steam games are in SyncR'}
              </span>
              {shown.length > 0 && (
                <>
                  <button onClick={() => setTicked(new Set(shown.filter((r) => r.game).map((r) => r.appId)))}>All</button>
                  <button onClick={() => setTicked(new Set())}>None</button>
                </>
              )}
              {skippedCount > 0 && (
                <label className="dialog-check">
                  <input type="checkbox" checked={showSkipped} onChange={(e) => setShowSkipped(e.target.checked)} />
                  Show skipped ({skippedCount})
                </label>
              )}
            </div>
            <div className="steam-import-list">
              {shown.map((row) => (
                <label key={row.appId} className={row.game ? 'steam-import-row' : 'steam-import-row unknown'} title={row.name}>
                  <input
                    type="checkbox"
                    checked={!!row.game && ticked.has(row.appId)}
                    disabled={!row.game}
                    onChange={(e) => tick(row.appId, e.target.checked)}
                  />
                  <Cover coverId={row.game?.coverId} />
                  <span className="steam-import-text">
                    <span className="steam-import-name" title={row.name}>{row.name}</span>
                    <span className="steam-import-details">
                      {[
                        row.minutes > 0 ? playedText(row.minutes) : 'Never played',
                        !row.game && 'Not found on IGDB',
                        skipped.has(row.appId) && 'Skipped',
                      ].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </>
        )}
        <div className="dialog-buttons">
          <button onClick={onClose}>Cancel</button>
          {!error && rows && shown.length > 0 && (
            <button className="primary" onClick={confirm} disabled={busy}>
              {chosen.length > 0 ? `Add ${chosen.length} to Library` : 'Skip all'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
