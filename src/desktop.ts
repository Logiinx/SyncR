import { invoke, isTauri } from '@tauri-apps/api/core'
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'
import { read, write } from './localState'

// Running in the background on the PC: what ✕ does, start with Windows, reminder sound.
// Stored per device, never synced (Settings dialog).

export interface Background {
  closeToTray: boolean // ✕ hides SyncR in the tray (it keeps running for reminders) instead of quitting
  reminderSound: boolean // short chime when a reminder comes due (chime.ts)
}

const KEY = 'syncr.background'
const DEFAULTS: Background = { closeToTray: false, reminderSound: true }

export function loadBackground(): Background {
  return { ...DEFAULTS, ...read<Partial<Background>>(KEY, {}) }
}

export function saveBackground(background: Background) {
  write(KEY, background)
}

// "Start with Windows" lives in Windows itself (a sign-in entry made by the autostart
// plugin), so it's read from there instead of being stored here. It starts SyncR with
// --hidden: only the tray icon shows (see startedHidden).
export const startsWithWindows = () => (isTauri() ? isEnabled() : Promise.resolve(false))
export const setStartWithWindows = (on: boolean) => (on ? enable() : disable())

// Was SyncR started by Windows at sign-in? (lib.rs, started_hidden)
export const startedHidden = () => (isTauri() ? invoke<boolean>('started_hidden') : Promise.resolve(false))
