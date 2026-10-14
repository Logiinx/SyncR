import { read, write } from './localState'

// How the app looks on this device (Settings dialog). Stored per device, never synced.

export interface Appearance {
  scale: number // whole app, in % (like a browser's zoom)
  font: FontId // note text only
  fontSize: number // note text only, in px
}

// Fonts for the note text. The four named ones are built into the app (fonts.css),
// so they look the same on every device.
export const FONTS = {
  system: { name: 'System default', css: 'system-ui, sans-serif' },
  'sans-serif': { name: 'Sans-serif', css: 'sans-serif' },
  inter: { name: 'Inter', css: "'Inter Variable', sans-serif" },
  'google-sans-flex': { name: 'Google Sans Flex', css: "'Google Sans Flex Variable', sans-serif" },
  literata: { name: 'Literata', css: "'Literata Variable', serif" },
  'jetbrains-mono': { name: 'JetBrains Mono', css: "'JetBrains Mono Variable', monospace" },
}
export type FontId = keyof typeof FONTS

export const SCALE_MIN = 80
export const SCALE_MAX = 150
export const FONT_SIZE_MIN = 12
export const FONT_SIZE_MAX = 24

const KEY = 'syncr.appearance'
const DEFAULTS: Appearance = { scale: 100, font: 'system', fontSize: 16 }

export function loadAppearance(): Appearance {
  const saved = { ...DEFAULTS, ...read<Partial<Appearance>>(KEY, {}) }
  if (!(saved.font in FONTS)) saved.font = DEFAULTS.font
  return saved
}

export function saveAppearance(appearance: Appearance) {
  write(KEY, appearance)
  applyAppearance(appearance)
}

export function applyAppearance({ scale, font, fontSize }: Appearance) {
  const root = document.documentElement
  // Scaling: CSS zoom on the whole page. --zoom lets heights based on the window (100vh)
  // be divided back, otherwise the app would be taller than the window (see index.css).
  const zoom = String(scale / 100)
  root.style.zoom = zoom
  root.style.setProperty('--zoom', zoom)
  // Font and size of the note text (see .editor .tiptap in index.css)
  root.style.setProperty('--note-font', FONTS[font].css)
  root.style.setProperty('--note-size', `${fontSize}px`)
}
