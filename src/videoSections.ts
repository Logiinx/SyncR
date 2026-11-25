import { liveQuery } from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { COLORS } from './cardColors'
import { changed, db } from './db'

// The Video tab's sections (Queue, From your follows, Rewatch; Settings → Video, user 2026-11-25):
// each one's color from the note palette, synced. Colors off: the same header (bar, tint, icon) in
// neutral gray. line: the thin line beside what's in a section in its color (faded), else gray.
const SETTING = 'videosections' // lower case: Dropbox lists file names in lower case

export type SectionName = 'queue' | 'follows' | 'rewatch'

export interface SectionColors {
  on: boolean
  line: boolean
  colors: Record<SectionName, string> // a palette id (cardColors.ts): 'blue', …
}

const DEFAULTS: SectionColors = {
  on: true,
  line: true,
  colors: { queue: 'blue', follows: 'purple', rewatch: 'green' },
}

// What was saved, with the defaults for anything missing or unknown (an older or newer version)
function valid(value: unknown): SectionColors {
  const saved = (value ?? {}) as Partial<SectionColors>
  const colors = { ...DEFAULTS.colors }
  for (const name of Object.keys(colors) as SectionName[]) {
    const color = saved.colors?.[name]
    if (COLORS.some(({ id }) => id === color)) colors[name] = color as string
  }
  return { on: saved.on !== false, line: saved.line !== false, colors }
}

const load = async () => valid((await db.settings.get(SETTING))?.value)

export const useSectionColors = () => useLiveQuery(load, [])

// A section's color for its rows' CSS (--video-<name>, set below; the defaults are in index.css)
export const sectionColor = (name: SectionName) => `var(--video-${name})` // i18n-ok

// Sets --video-<name> and the line's --video-section-line (none: in the section's color)
function apply({ on, line, colors }: SectionColors) {
  const root = document.documentElement
  for (const [name, color] of Object.entries(colors)) {
    root.style.setProperty(`--video-${name}`, on ? `var(--text-${color})` : 'var(--text-dim)')
  }
  if (on && line) root.style.removeProperty('--video-section-line')
  else root.style.setProperty('--video-section-line', 'var(--border)')
}

export async function saveSectionColors(change: Partial<SectionColors>) {
  const next = { ...(await load()), ...change }
  apply(next) // right away, not when the database has answered
  const row = { value: next, updatedAt: Date.now() }
  if (!(await db.settings.update(SETTING, row))) await db.settings.put({ name: SETTING, ...row })
  changed()
}

// Once the database is open: follows the saved colors, also when sync brings them from another device
export function followSectionColors() {
  liveQuery(() => db.settings.get(SETTING)).subscribe((row) => apply(valid(row?.value)))
}
