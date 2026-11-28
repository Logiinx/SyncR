import { useSyncExternalStore } from 'react'
import { liveQuery } from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { COLORS } from './cardColors'
import { changed, db } from './db'

// The Video tab's sections (Queue, From your follows, Rewatch; Settings → Video, user 2026-11-25;
// Added by you, user 2026-11-28): each one's color from the note palette, synced. Colors off: the
// same header (bar, tint, icon) in neutral gray. line: the thin line beside what's in a section in
// its color (faded), else gray.
const SETTING = 'videosections' // lower case: Dropbox lists file names in lower case

export type SectionName = 'queue' | 'follows' | 'added' | 'rewatch'

export interface SectionColors {
  on: boolean
  line: boolean
  colors: Record<SectionName, string> // a palette id (cardColors.ts): 'blue', …
}

const DEFAULTS: SectionColors = {
  on: true,
  line: true,
  colors: { queue: 'blue', follows: 'purple', added: 'orange', rewatch: 'green' },
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

// Sets --video-<name> and the line's --video-section-line (none: in the section's color; set: the
// same faded mix in gray, as --border barely shows on the background)
function apply({ on, line, colors }: SectionColors) {
  const root = document.documentElement
  for (const [name, color] of Object.entries(colors)) {
    root.style.setProperty(`--video-${name}`, on ? `var(--text-${color})` : 'var(--text-dim)')
  }
  if (on && line) root.style.removeProperty('--video-section-line')
  else root.style.setProperty('--video-section-line', 'color-mix(in srgb, var(--text-dim) 40%, transparent)') // i18n-ok
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

// To watch's order (user, 2026-11-28): its sections, your folders and playlists at the top, by their
// ids, as dragged (videoDrag.ts). Synced like the colors. A new folder or playlist (not in it yet)
// goes just above Rewatch; what's gone is skipped. Kept here too, so a drop shows at once.
const ORDER = 'videoorder' // lower case, see SETTING
let order: string[] = []
const orderListeners = new Set<() => void>()
function setOrder(next: string[]) {
  order = next
  for (const listener of orderListeners) listener()
}
const validOrder = (value: unknown) => (Array.isArray(value) ? value.filter((key): key is string => typeof key === 'string') : [])

export const useSectionOrder = () => useSyncExternalStore((listener) => {
  orderListeners.add(listener)
  return () => orderListeners.delete(listener)
}, () => order)

// present: what there is now, in the default order (Queue, From your follows, Added by you, your
// playlists and folders, Rewatch)
export function inOrder(saved: string[], present: string[]) {
  const kept = saved.filter((key) => present.includes(key))
  const fresh = present.filter((key) => !kept.includes(key))
  const rewatch = kept.indexOf('rewatch') // i18n-ok
  return rewatch < 0 ? [...kept, ...fresh] : [...kept.slice(0, rewatch), ...fresh, ...kept.slice(rewatch)]
}

export async function saveSectionOrder(next: string[]) {
  setOrder(next) // right away, before the database answers
  const row = { value: next, updatedAt: Date.now() }
  if (!(await db.settings.update(ORDER, row))) await db.settings.put({ name: ORDER, ...row })
  changed()
}

// Once the database is open, like the colors
export function followSectionOrder() {
  liveQuery(() => db.settings.get(ORDER)).subscribe((row) => setOrder(validOrder(row?.value)))
}
