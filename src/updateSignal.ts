import { instantOn } from './instantMail'
import { read, write } from './localState'

// Instant updates (PC): once a release is published, GitHub drops a note in instant mail's queue
// (update-signal.yml → instantMail.ts → the 'update-signal' event → UpdateBanner.tsx). Once a
// note has come, the chosen check (Settings → Window and privacy) only runs every 6 hours, as a
// safety net. If a quiet check then finds a version no note announced, the notes have stopped
// (key removed, setup changed): the chosen check comes back until the next note.
// Stored per PC, never synced.

const KEY = 'syncr.update.signal'
type Signal = { working: boolean; version: string } // version: the last real one announced

const load = () => read<Signal>(KEY, { working: false, version: '' })
const bare = (version: string) => version.trim().replace(/^v/, '')

// Notes come in and the release sends them
export const signalsWork = () => instantOn() && load().working

// A note came: "test" from the workflow's button proves the chain, but announces no version
export function noteSignal(version: string) {
  const real = version && version !== 'test'
  write(KEY, { working: true, version: real ? bare(version) : load().version })
}

// A quiet check (not the one at start-up: the note may still be waiting in the queue) found
// this version
export function noteFound(version: string) {
  const signal = load()
  if (signal.working && signal.version !== bare(version)) write(KEY, { ...signal, working: false })
}

// Minutes between quiet checks: the chosen ones, or 6 hours while the notes work (never more
// often than chosen; 0 = only at start-up)
export function checkEvery(chosen: number) {
  return signalsWork() && chosen > 0 ? Math.max(chosen, 360) : chosen
}
