import { invoke, isTauri } from '@tauri-apps/api/core'
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'
import type { Monitor } from '@tauri-apps/api/window'
import { read, write } from './localState'
import type { SoundId } from './sounds'

// Running in the background on the PC: what ✕ does, start with Windows, reminder sound,
// where the pop-up shows.
// Stored per device, never synced (Settings dialog).

export interface Background {
  closeToTray: boolean // ✕ hides SyncR in the tray (it keeps running for reminders) instead of quitting
  reminderSoundId: SoundId // played when a reminder comes due (sounds.ts)
  emailSoundId: SoundId // played for new emails (Gmail, gmail.ts)
  emailFade: number // seconds until an email's pop-up fades by itself (0: never; reminders never fade)
  startHidden: boolean // started by Windows at sign-in: stay in the tray instead of showing the window
  popupScreen: string | null // the screen the pop-up shows on (its Windows name); null = the main screen
  popupScreenSpot: ScreenSpot | null // that screen's place and size, to find it if Windows renames it
  popupCorner: PopupCorner
}

export type PopupCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
export type ScreenSpot = { x: number; y: number; width: number; height: number }

export const BACKGROUND_KEY = 'syncr.background'
const DEFAULTS: Background = {
  closeToTray: false,
  reminderSoundId: 'chime',
  emailSoundId: 'double',
  emailFade: 0,
  startHidden: false,
  popupScreen: null,
  popupScreenSpot: null,
  popupCorner: 'bottom-right',
}

export function loadBackground(): Background {
  // Before the list of sounds, the reminder sound was an on/off switch: off = None
  const { reminderSound, ...stored } = read<Partial<Background> & { reminderSound?: boolean }>(BACKGROUND_KEY, {})
  return { ...DEFAULTS, ...(reminderSound === false && { reminderSoundId: 'none' as const }), ...stored }
}

export function saveBackground(background: Background) {
  write(BACKGROUND_KEY, background)
}

export const screenSpot = ({ position, size }: Monitor): ScreenSpot => ({
  x: position.x,
  y: position.y,
  width: size.width,
  height: size.height,
})
const sameSpot = (a: ScreenSpot, b: ScreenSpot) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

// The chosen pop-up screen among those plugged in, if it's there. Windows can renumber its screens
// (its names are like DISPLAY2: after a restart, waking from sleep…), so its place and size come
// first (two screens can even swap names); the name when they changed (screens rearranged).
export function findPopupScreen(monitors: Monitor[], { popupScreen, popupScreenSpot }: Background) {
  if (!popupScreen) return undefined
  const spot = popupScreenSpot
  return (spot && monitors.find((m) => sameSpot(screenSpot(m), spot))) ?? monitors.find((m) => m.name === popupScreen)
}

// What to save so the chosen screen's name and spot stay up to date (null: nothing). Not when it's
// the main screen now: the main screen always sits at 0,0, a spot that says nothing about this one.
export function popupScreenChange(monitors: Monitor[], main: Monitor | null, background: Background) {
  const found = findPopupScreen(monitors, background)
  if (!found?.name || found.name === main?.name) return null
  const spot = screenSpot(found)
  const known = background.popupScreenSpot
  if (found.name === background.popupScreen && known && sameSpot(known, spot)) return null
  return { popupScreen: found.name, popupScreenSpot: spot }
}

// "Start with Windows" lives in Windows itself (a sign-in entry made by the autostart
// plugin), so it's read from there instead of being stored here. It starts SyncR with
// --hidden, so SyncR knows Windows started it (see startedHidden); the window then shows
// or stays in the tray depending on Background.startHidden.
export const startsWithWindows = () => (isTauri() ? isEnabled() : Promise.resolve(false))
export const setStartWithWindows = (on: boolean) => (on ? enable() : disable())

// Was SyncR started by Windows at sign-in? (lib.rs, started_hidden)
export const startedHidden = () => (isTauri() ? invoke<boolean>('started_hidden') : Promise.resolve(false))
