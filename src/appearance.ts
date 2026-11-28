import { t } from './i18n'
import { read, write } from './localState'
import { COLORS } from './cardColors'

// How the app looks on this device (Settings dialog). Stored per device, never synced.

export interface Appearance {
  scale: number // whole app, in % (like a browser's zoom)
  font: FontId // note text only
  fontSize: number // note text only, in px
  showDates: boolean // dates in the note list
  animations: boolean // slides and fades (off: things just appear)
  // A short sign that a sync sent or received changes (syncSign.ts): a line sweeping under the
  // tabs, a glow around the edge, or none. Never with animations off.
  syncSign: SyncSign
  syncSignColor: string // a palette color id (cardColors.ts COLORS): var(--text-<id>)
  // Black for OLED screens (their pixels are off there): the page black with menus and windows a
  // touch lighter, or those black too (index.css, .oled-black / .oled-all-black)
  background: Background
}

export type Background = 'gray' | 'black' | 'all-black'

export type SyncSign = 'off' | 'sweep' | 'edge'

// Fonts for the note text. The four named ones are built into the app (fonts.css),
// so they look the same on every device.
export const FONTS = {
  system: { name: '', css: 'system-ui, sans-serif' },
  'sans-serif': { name: 'Sans-serif', css: 'sans-serif' },
  inter: { name: 'Inter', css: "'Inter Variable', sans-serif" },
  'google-sans-flex': { name: 'Google Sans Flex', css: "'Google Sans Flex Variable', sans-serif" },
  literata: { name: 'Literata', css: "'Literata Variable', serif" },
  'jetbrains-mono': { name: 'JetBrains Mono', css: "'JetBrains Mono Variable', monospace" },
}
export type FontId = keyof typeof FONTS
export const fontName = (id: FontId) => (id === 'system' ? t('Default font') : FONTS[id].name)

export const SCALE_MIN = 80
export const SCALE_MAX = 150
export const FONT_SIZE_MIN = 12
export const FONT_SIZE_MAX = 24

const KEY = 'syncr.appearance'
export const DEFAULTS: Appearance = { scale: 100, font: 'system', fontSize: 16, showDates: true, animations: true, syncSign: 'off', syncSignColor: 'green', background: 'gray' }

export function loadAppearance(): Appearance {
  const saved = { ...DEFAULTS, ...read<Partial<Appearance>>(KEY, {}) }
  if (!(saved.font in FONTS)) saved.font = DEFAULTS.font
  if (!['off', 'sweep', 'edge'].includes(saved.syncSign)) saved.syncSign = DEFAULTS.syncSign // i18n-ok
  if (!COLORS.some(({ id }) => id === saved.syncSignColor)) saved.syncSignColor = DEFAULTS.syncSignColor
  if (!['gray', 'black', 'all-black'].includes(saved.background)) saved.background = DEFAULTS.background // i18n-ok
  return saved
}

export function saveAppearance(appearance: Appearance) {
  write(KEY, appearance)
  applyAppearance(appearance)
}

// The current app scaling as a factor (1.1 = 110 %). Mouse positions (clientX, …) are in
// screen pixels; divide them by this to place something at that spot in the zoomed page.
export function currentZoom() {
  return Number(document.documentElement.style.getPropertyValue('--zoom')) || 1
}

// One screen pixel in the page's own pixels (app scaling × Windows' display scaling), as
// --device-px: the windows' rise stops on whole screen pixels only (index.css, window-rise).
// Followed when the window moves to a screen with another scaling.
function setDevicePixel() {
  document.documentElement.style.setProperty('--device-px', `${1 / (currentZoom() * devicePixelRatio)}px`)
}
function followDevicePixel() {
  matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener(
    'change',
    () => {
      setDevicePixel()
      followDevicePixel()
    },
    { once: true },
  )
}
followDevicePixel()

// The background (also in the pop-up, which takes nothing else from here). The phone's status bar
// follows through theme-color; index.html reads the setting too, so the start is black already.
export function applyBackground({ background }: Appearance) {
  const root = document.documentElement
  root.classList.toggle('oled-black', background === 'black')
  root.classList.toggle('oled-all-black', background === 'all-black')
  const color = getComputedStyle(root).getPropertyValue('--bg').trim()
  if (color) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color)
}

export function applyAppearance(appearance: Appearance) {
  const { scale, font, fontSize, showDates, animations } = appearance
  applyBackground(appearance)
  const root = document.documentElement
  // Scaling: CSS zoom on the whole page. --zoom lets heights based on the window (100vh)
  // be divided back, otherwise the app would be taller than the window (see index.css).
  const zoom = String(scale / 100)
  root.style.zoom = zoom
  root.style.setProperty('--zoom', zoom)
  setDevicePixel()
  // Font and size of the note text (see .editor .tiptap in index.css)
  root.style.setProperty('--note-font', FONTS[font].css)
  root.style.setProperty('--note-size', `${fontSize}px`)
  // Dates in the note list (see .hide-note-dates in index.css)
  root.classList.toggle('hide-note-dates', !showDates)
  // Animations off (see .no-animations in index.css, animations.ts)
  root.classList.toggle('no-animations', !animations)
}
