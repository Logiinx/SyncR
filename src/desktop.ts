import { invoke, isTauri } from '@tauri-apps/api/core'
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'
import { read, write } from './localState'

// Running in the background on the PC: what ✕ does, start with Windows, reminder sound,
// where the pop-up shows.
// Stored per device, never synced (Settings dialog).

export interface Background {
  closeToTray: boolean // ✕ hides SyncR in the tray (it keeps running for reminders) instead of quitting
  reminderSound: boolean // short chime when a reminder comes due (chime.ts)
  startHidden: boolean // started by Windows at sign-in: stay in the tray instead of showing the window
  popupScreen: string | null // the screen the pop-up shows on (its Windows name); null = the main screen
  popupCorner: PopupCorner
}

export type PopupCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export const BACKGROUND_KEY = 'syncr.background'
const DEFAULTS: Background = {
  closeToTray: false,
  reminderSound: true,
  startHidden: false,
  popupScreen: null,
  popupCorner: 'bottom-right',
}

export function loadBackground(): Background {
  return { ...DEFAULTS, ...read<Partial<Background>>(BACKGROUND_KEY, {}) }
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
