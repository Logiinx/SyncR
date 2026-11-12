import { liveQuery } from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { COLORS } from './cardColors'
import { changed, db } from './db'
import type { SpecialTab } from './tabIcons'

// The Games, Reminders, Mail and Video icons' colors (Settings → App): synced, so every device
// shows the same. Off (the default): the icons take the grey of the text next to them.
const SETTING = 'tabcolors' // lower case: Dropbox lists file names in lower case

export interface TabColors {
  on: boolean
  colors: Record<SpecialTab, string> // a palette id (cardColors.ts): 'green', …
}

export const TAB_COLOR_DEFAULTS: TabColors = {
  on: false,
  colors: { games: 'green', reminders: 'yellow', mail: 'blue', video: 'red' },
}

// What was saved, with the defaults for anything missing or unknown (an older or newer version)
function valid(value: unknown): TabColors {
  const saved = (value ?? {}) as Partial<TabColors>
  const colors = { ...TAB_COLOR_DEFAULTS.colors }
  for (const kind of Object.keys(colors) as SpecialTab[]) {
    const color = saved.colors?.[kind]
    if (COLORS.some(({ id }) => id === color)) colors[kind] = color as string
  }
  return { on: saved.on === true, colors }
}

const load = async () => valid((await db.settings.get(SETTING))?.value)

export const useTabColors = () => useLiveQuery(load, [])

// Sets --tab-<kind> (index.css). currentColor on an icon's own color = the color around it
function apply({ on, colors }: TabColors) {
  const root = document.documentElement
  for (const [kind, color] of Object.entries(colors)) {
    root.style.setProperty(`--tab-${kind}`, on ? `var(--text-${color})` : 'currentColor')
  }
}

export async function saveTabColors(change: Partial<TabColors>) {
  const next = { ...(await load()), ...change }
  apply(next) // right away, not when the database has answered
  const row = { value: next, updatedAt: Date.now() }
  if (!(await db.settings.update(SETTING, row))) await db.settings.put({ name: SETTING, ...row })
  changed()
}

// Once the database is open: follows the saved colors, also when sync brings them from another
// device or the other window changes them.
export function followTabColors() {
  liveQuery(() => db.settings.get(SETTING)).subscribe((row) => apply(valid(row?.value)))
}
