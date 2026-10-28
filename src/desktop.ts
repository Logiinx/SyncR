import { invoke, isTauri } from '@tauri-apps/api/core'
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'
import { read, write } from './localState'
import type { SoundId } from './sounds'

// Running in the background on the PC: what ✕ does, start with Windows, reminder sound,
// where the pop-up shows.
// Stored per device, never synced (Settings dialog).

export interface Background {
  closeToTray: boolean // ✕ hides SyncR in the tray (it keeps running for reminders) instead of quitting
  reminderSoundId: SoundId // played when a reminder comes due (sounds.ts)
  emailSoundId: SoundId // played for new emails (Gmail, gmail.ts)
  startHidden: boolean // started by Windows at sign-in: stay in the tray instead of showing the window
  popupScreen: string | null // the screen the pop-up shows on (its Windows name); null = the main screen
  popupCorner: PopupCorner
}

export type PopupCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export const BACKGROUND_KEY = 'syncr.background'
const DEFAULTS: Background = {
  closeToTray: false,
  reminderSoundId: 'chime',
  emailSoundId: 'double',
  startHidden: false,
  popupScreen: null,
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

// "Start with Windows" lives in Windows itself (a sign-in entry made by the autostart
// plugin), so it's read from there instead of being stored here. It starts SyncR with
// --hidden, so SyncR knows Windows started it (see startedHidden); the window then shows
// or stays in the tray depending on Background.startHidden.
export const startsWithWindows = () => (isTauri() ? isEnabled() : Promise.resolve(false))
export const setStartWithWindows = (on: boolean) => (on ? enable() : disable())

// Was SyncR started by Windows at sign-in? (lib.rs, started_hidden)
export const startedHidden = () => (isTauri() ? invoke<boolean>('started_hidden') : Promise.resolve(false))
