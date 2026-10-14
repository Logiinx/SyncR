import { read, write } from './localState'

// How the app looks on this device (Settings dialog). Stored per device, never synced.

export interface Appearance {
  scale: number // whole app, in % (like a browser's zoom)
}

export const SCALE_MIN = 80
export const SCALE_MAX = 150

const KEY = 'syncr.appearance'
const DEFAULTS: Appearance = { scale: 100 }

export function loadAppearance(): Appearance {
  return { ...DEFAULTS, ...read<Partial<Appearance>>(KEY, {}) }
}

export function saveAppearance(appearance: Appearance) {
  write(KEY, appearance)
  applyAppearance(appearance)
}

// Scaling: CSS zoom on the whole page. --zoom lets heights based on the window (100vh)
// be divided back, otherwise the app would be taller than the window (see index.css).
export function applyAppearance({ scale }: Appearance) {
  const root = document.documentElement
  const zoom = String(scale / 100)
  root.style.zoom = zoom
  root.style.setProperty('--zoom', zoom)
}
