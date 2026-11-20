import { useEffect, useState, useSyncExternalStore } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { animationsOn } from './animations'
import { decimal, percentText, t } from './i18n'
import { read, write } from './localState'

// Hardware module (PC, Settings → Modules): temperatures, loads, power, clocks, memory and fan, read by Rust
// (hardware.rs) and shown in a small widget on the desktop (hardware_widget.rs). Its settings are kept on
// this device, never synced. This sends Rust the settings, at start and on every change. Off: Rust
// runs nothing and opens no library.

// The sensors, in the order the settings window lists them. Rust reads only the ones asked for.
export const SENSORS = ['cpuTemp', 'cpuLoad', 'cpuClock', 'gpuTemp', 'gpuMemTemp', 'gpuLoad', 'gpuPower', 'gpuClock', 'gpuMemClock', 'gpuMemUsed', 'gpuFan', 'ram'] as const
export type Sensor = (typeof SENSORS)[number]

export interface HardwareSettings {
  on: boolean
  everyMs: number // how often the sensors are read
  shown: Sensor[] // what the widget shows
  place: [number, number] | null // the widget's top left on screen (pixels), once it was placed or moved
  onTop: boolean // above other windows (else on the desktop, under them)
  locked: boolean // can't be dragged
  fahrenheit: boolean // temperatures in °F (else °C)
  // A: rows like LibreHardwareMonitor · B: one line, values only · C: a tile per hardware · D: rows
  // with a bar under each value (design/hardware-looks.html)
  look: 'rows' | 'line' | 'tiles' | 'bars'
  theme: 'dark' | 'blue' // the widget's colors: SyncR's dark, or a deep SyncR blue with white text
  frame: 'none' | 'gray' | 'blue' // the line around its box
  size: number // its size in %, on top of Windows' scaling of its monitor (SIZES)
  background: number // how solid its box is, in % (BACKGROUNDS): 0 = no box, only the text and frame
  // Clicks go to what's under it: none (off), all, or left ones only (a right-click opens its menu).
  // Ctrl held over it makes it clickable again.
  clickThrough: 'off' | 'all' | 'left'
  hot: boolean // temperatures turn orange, then red, past their limits
  limits: Record<HotSensor, [number, number]> // °C: orange from the first, red from the second
}

// The readings that get hot colors: only temperatures (a 100 % load is normal in games)
export const HOT_SENSORS = ['cpuTemp', 'gpuTemp', 'gpuMemTemp'] as const
export type HotSensor = (typeof HOT_SENSORS)[number]
export const HOT_MARGIN = 2 // °C: a color goes away only this far under its limit, so it doesn't blink at the edge

const KEY = 'syncr.hardware'
const DEFAULTS: HardwareSettings = {
  on: false,
  everyMs: 1000,
  shown: ['cpuTemp', 'gpuTemp'],
  place: null,
  onTop: false,
  locked: false,
  fahrenheit: false,
  look: 'rows',
  theme: 'dark',
  frame: 'blue',
  size: 100,
  background: 100,
  clickThrough: 'off',
  hot: true,
  limits: { cpuTemp: [75, 85], gpuTemp: [75, 83], gpuMemTemp: [85, 95] },
}
export const SPEEDS = [500, 1000, 2000, 5000]
export const SIZES = [80, 90, 100, 110, 125, 150]
export const BACKGROUNDS = [100, 75, 50, 25, 0]
// The widget's looks, themes and frame lines, with their names (the menu and the settings window)
export const LOOKS: [HardwareSettings['look'], () => string][] = [
  ['rows', () => t('Rows')],
  ['bars', () => t('Rows with bars')],
  ['tiles', () => t('Tiles')],
  ['line', () => t('One line')],
]
export const THEMES: [HardwareSettings['theme'], () => string][] = [
  ['dark', () => t('Dark')],
  ['blue', () => t('SyncR blue')],
]
export const FRAMES: [HardwareSettings['frame'], () => string][] = [
  ['none', () => t('None')],
  ['gray', () => t('Gray')],
  ['blue', () => t('Blue')],
]
export const CLICK_THROUGH: [HardwareSettings['clickThrough'], () => string][] = [
  ['off', () => t('Off')],
  ['all', () => t('All clicks')],
  ['left', () => t('Left clicks only')],
]
export const clickThroughAbout = () =>
  t('Clicks go to what’s under the widget. Hold Ctrl over it to click it: move it, open its menu. “Left clicks only”: a right-click still opens its menu.')

let current: HardwareSettings = storedHardware()
const listeners = new Set<() => void>()
let windowOpen = false // the settings window shows every sensor, so all are read while it's open
let last: HardwareReadings | null = null // the latest readings, so a changed option shows at once
let preview: Partial<HardwareSettings> | null = null // a look, theme, frame, size or background under the mouse in the widget's menu
const heat: Partial<Record<HotSensor, number>> = {} // each temperature's color now: 0 none, 1 orange, 2 red
// Whether this GPU has a memory temperature (null: not asked yet since SyncR started). Once seen it
// stays, so one failed reading doesn't hide its rows.
let memTemp: boolean | null = null

export function saveHardware(change: Partial<HardwareSettings>) {
  current = { ...current, ...change }
  write(KEY, current)
  updateHeat(last) // new limits, or turned on or off: the colors follow at once
  keepPeaks()
  listeners.forEach((listener) => listener())
  send()
  sendWidget(current.on ? last : null) // no more readings come when off: closed now
}

// The settings as saved on this device, for the widget's menu (its own page, hardwareMenu.tsx)
export function storedHardware(): HardwareSettings {
  const stored = read<Partial<HardwareSettings>>(KEY, {})
  return { ...DEFAULTS, ...stored, limits: { ...DEFAULTS.limits, ...stored.limits } }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useHardware() {
  return useSyncExternalStore(subscribe, () => current)
}

// Only when what's read changes: Rust reads again at once on each config, and a look, size or
// limit changed (or Ctrl + wheel) would read again a few ms after the last reading, which made
// the CPU load jump (it's measured over the time between two readings)
let sent = '' // the config Rust has
function send() {
  if (!isTauri()) return
  const { on, everyMs } = current
  const sensors = windowOpen ? [...SENSORS] : current.shown
  const config = { on, everyMs, sensors }
  const key = JSON.stringify(config)
  if (key === sent) return
  sent = key
  invoke('hardware_config', { config }).catch((error) => {
    sent = '' // sent again next time
    console.error(error)
  })
}

// Main window only (main.tsx), once at start. Every reading updates the widget (a changed tick or
// speed reads again at once, so the widget follows); where the user drags it is saved here.
export function startHardware() {
  if (!isTauri()) return
  void listen<HardwareReadings>('hardware', (event) => {
    last = event.payload
    if (last.gpuMemTemp !== null) memTemp = true
    // Only a reading that was asked for it says the GPU has none (one under an older config can come late)
    else if (memTemp === null && last.sensors.includes('gpuMemTemp')) memTemp = false
    updateHeat(last)
    updatePeaks(last)
    sendWidget(last)
  })
  // The widget's right-click menu (hardware_menu in hardware_widget.rs): a changed option, or
  // "Hide widget" (the module off). "Hardware settings…" is App's (listenHardwareOpen).
  // A choice draws the widget once, with it (saveHardware): not first with the saved setting, which
  // flashed it between the preview and the choice
  void listen<MenuChoice>('hardware-menu', ({ payload }) => {
    if (payload.change) {
      preview = null
      saveHardware(payload.change)
    } else if (payload.preview !== undefined) {
      preview = payload.preview ?? null
      sendWidget(current.on ? last : null)
    }
    if (payload.hide) toggleHardware(false)
    if (payload.resetPeaks) resetPeaks()
  })
  // Ctrl + mouse wheel over the widget: one size up or down per notch (Rust ignores it when locked)
  void listen<number>('hardware-widget-zoom', ({ payload: step }) => {
    const size = nextSize(current.size, step)
    if (size !== current.size) saveHardware({ size })
  })
  void listen<[number, number]>('hardware-widget-moved', (event) => {
    current = { ...current, place: event.payload }
    write(KEY, current)
  })
  if (current.on) send()
}

// One size up (step > 0) or down from this one, staying inside the list (a size not in it goes to
// its neighbour that way)
export function nextSize(size: number, step: number) {
  if (step > 0) return SIZES.find((s) => s > size) ?? SIZES[SIZES.length - 1]
  return SIZES.findLast((s) => s < size) ?? SIZES[0]
}

export interface MenuChoice {
  change?: Partial<HardwareSettings>
  hide?: boolean
  resetPeaks?: boolean
  preview?: Partial<HardwareSettings> | null // shown on the widget, not saved (null: back to the saved one)
}

// "Hardware settings…" in the widget's menu: App opens Settings on the Hardware window
export function listenHardwareOpen(open: () => void) {
  if (!isTauri()) return () => {}
  const stop = listen('hardware-open', open)
  return () => void stop.then((unlisten) => unlisten())
}

// Settings → Modules. Turning it on sets up the admin helper for the CPU temperature (one admin
// prompt) if it isn't yet and the widget shows that temperature; said No: the settings window
// offers "Set up" (HardwareSettings.tsx).
export function toggleHardware(on: boolean) {
  saveHardware({ on })
  if (on && current.shown.includes('cpuTemp')) void setUpHelper(true)
}

// The CPU temperature comes from an admin helper (hardware_helper.rs); why it's missing:
// ok · unsupported (not a Ryzen: not offered) · noPawnio · noHelper (not set up) · notRunning ·
// outdated (set up by an older SyncR) · failed (this reading)
export type HelperState = 'ok' | 'unsupported' | 'noPawnio' | 'noHelper' | 'notRunning' | 'outdated' | 'failed'

// One admin prompt each. ifMissing: only if it isn't set up yet. Answers "ok", "declined" (the
// user said No), "failed", or a HelperState that prevents it.
export function setUpHelper(ifMissing = false) {
  return invoke<string>('hardware_helper_setup', { ifMissing }).catch(() => 'failed')
}

export function removeHelper() {
  return invoke<string>('hardware_helper_remove').catch(() => 'failed')
}

// As hardware.rs sends it (null: not asked for, or this PC can't give it)
export interface HardwareReadings {
  cpuName: string | null
  gpuName: string | null
  cpuLoad: number | null
  cpuClock: number | null
  cpuTemp: number | null
  cpuTempState: HelperState | null // null: not asked for
  gpuTemp: number | null
  gpuMemTemp: number | null // null also on cards without that sensor
  gpuLoad: number | null
  gpuPower: number | null // W
  gpuClock: number | null
  gpuMemClock: number | null
  gpuMemUsed: number | null // bytes
  gpuMemTotal: number | null
  gpuFan: number | null
  gpuFanRpm: number | null
  ramUsed: number | null
  ramTotal: number | null
  at: number
  sensors: string[] // what this reading was asked for
}

// The latest readings, for the settings window, which asks for every sensor while it's open
// (null: off, or not read yet)
export function useHardwareReadings(on: boolean) {
  const [readings, setReadings] = useState<HardwareReadings | null>(null)
  useEffect(() => {
    setReadings(null)
    if (!isTauri() || !on) return
    windowOpen = true
    send()
    let gone = false
    invoke<HardwareReadings | null>('hardware_readings').then((now) => !gone && now && setReadings(now), console.error)
    const stop = listen<HardwareReadings>('hardware', (event) => setReadings(event.payload))
    return () => {
      gone = true
      windowOpen = false
      send()
      void stop.then((unlisten) => unlisten())
    }
  }, [on])
  return readings
}

// The settings window's GPU memory rows: shown until a reading that asked for it says this GPU has
// none (it re-renders on each reading), so they don't show up late on cards with it. Cards without
// it see them only until the first such reading after SyncR starts.
export function hasMemTemp() {
  return memTemp ?? true
}

// "AMD Ryzen 7 5700X3D 8-Core Processor" → "Ryzen 7 5700X3D",
// "Intel(R) Core(TM) i7-12700K" → "Core i7-12700K"
export function shortCpuName(name: string) {
  return name
    .trim() // Windows sometimes pads it with spaces
    .replace(/\((R|TM|tm)\)/g, '')
    .replace(/\s+CPU\s+@.*$/i, '')
    .replace(/\s+\d+-Core Processor$/i, '')
    .replace(/\s+Processor$/i, '')
    .replace(/^(AMD|Intel)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// "NVIDIA GeForce RTX 5070 Ti" → "RTX 5070 Ti"
export function shortGpuName(name: string) {
  return name.replace(/^NVIDIA\s+/i, '').replace(/^GeForce\s+/i, '').trim()
}

// A hardware group's name (WIDGET_GROUPS): the hardware's own short name when readings with it are
// given, else "CPU", "GPU" or "Memory". The same in the settings window, the widget and its menu.
export function groupName(icon: 'cpu' | 'gpu' | 'memory', r?: Pick<HardwareReadings, 'cpuName' | 'gpuName'> | null) {
  if (icon === 'cpu') return r?.cpuName ? shortCpuName(r.cpuName) : t('CPU')
  if (icon === 'gpu') return r?.gpuName ? shortGpuName(r.gpuName) : t('GPU')
  return t('Memory')
}

const GB = 1024 ** 3 // like Task Manager

// A reading's name: the settings window's, or the widget's (shorter where the name is long)
export function sensorLabel(sensor: Sensor, short = false) {
  switch (sensor) {
    case 'cpuTemp':
    case 'gpuTemp':
      return t('Temperature')
    case 'gpuMemTemp':
      return short ? t('Memory temp.') : t('Memory temperature')
    case 'cpuLoad':
    case 'gpuLoad':
      return t('Load')
    case 'cpuClock':
    case 'gpuClock':
      return t('Clock')
    case 'gpuMemClock':
      return t('Memory clock')
    case 'gpuMemUsed':
      return t('Memory used')
    case 'gpuPower':
      return t('Power')
    case 'gpuFan':
      return t('Fan')
    case 'ram':
      return t('RAM used')
  }
}

// A reading as text, the same in the settings window and the widget; null when this PC can't give it
export function valueText(sensor: Sensor, r: HardwareReadings): string | null {
  const temperature = (n: number | null) => (n === null ? null : temperatureText(n))
  const mhz = (n: number | null) => (n === null ? null : t('{n} MHz', { n: decimal(n, 0) }))
  const percent = (n: number | null) => (n === null ? null : percentText(Math.round(n)))
  switch (sensor) {
    case 'cpuTemp':
      return temperature(r.cpuTemp)
    case 'cpuLoad':
      return percent(r.cpuLoad)
    case 'cpuClock':
      return mhz(r.cpuClock)
    case 'gpuTemp':
      return temperature(r.gpuTemp)
    case 'gpuMemTemp':
      return temperature(r.gpuMemTemp)
    case 'gpuLoad':
      return percent(r.gpuLoad)
    case 'gpuClock':
      return mhz(r.gpuClock)
    case 'gpuMemClock':
      return mhz(r.gpuMemClock)
    case 'gpuPower':
      return r.gpuPower === null ? null : wattsText(r.gpuPower)
    case 'gpuMemUsed':
      return gigabytes(r.gpuMemUsed, r.gpuMemTotal)
    case 'gpuFan':
      if (r.gpuFan === null) return null
      return r.gpuFanRpm === null ? percent(r.gpuFan) : t('{percent} · {rpm} RPM', { percent: percentText(Math.round(r.gpuFan)), rpm: decimal(r.gpuFanRpm, 0) })
    case 'ram':
      return gigabytes(r.ramUsed, r.ramTotal)
  }
}

function temperatureText(celsius: number) {
  return current.fahrenheit ? t('{n} °F', { n: decimal((celsius * 9) / 5 + 32, 1) }) : t('{n} °C', { n: decimal(celsius, 1) })
}

function wattsText(watts: number) {
  return t('{n} W', { n: decimal(watts, 0) })
}

// "6.2 / 16.0 GB" (RAM and video memory)
function gigabytes(used: number | null, total: number | null) {
  if (used === null || total === null) return null
  return t('{used} / {total} GB', { used: decimal(used / GB, 1), total: decimal(total / GB, 1) })
}

// How full a used / total reading is (0–1)
function share(used: number | null, total: number | null) {
  return used === null || !total ? null : Math.min(used / total, 1)
}

// How full a reading's bar is in look D (0–1): temperatures out of 100 °C, loads, the fan and RAM
// out of their whole; null for readings without a top (clocks, power)
function barFull(sensor: Sensor, r: HardwareReadings): number | null {
  const of100 = (n: number | null) => (n === null ? null : Math.min(Math.max(n / 100, 0), 1))
  switch (sensor) {
    case 'cpuTemp':
    case 'gpuTemp':
    case 'gpuMemTemp':
    case 'cpuLoad':
    case 'gpuLoad':
    case 'gpuFan':
      return of100(r[sensor])
    case 'ram':
      return share(r.ramUsed, r.ramTotal)
    case 'gpuMemUsed':
      return share(r.gpuMemUsed, r.gpuMemTotal)
    default:
      return null
  }
}

// A temperature's color after this reading (0 none, 1 orange, 2 red), from its color before: it goes
// up as soon as a limit is reached, and back down only HOT_MARGIN under that limit
export function nextHeat(before: number, celsius: number, [warm, hot]: [number, number]) {
  const reached = celsius >= hot ? 2 : celsius >= warm ? 1 : 0
  let level = Math.max(before, reached)
  while (level > reached && celsius <= (level === 2 ? hot : warm) - HOT_MARGIN) level--
  return level
}

// Main window: every reading (and a changed limit) updates the three temperatures' colors. Not
// read, or hot colors off: none.
function updateHeat(r: HardwareReadings | null) {
  for (const sensor of HOT_SENSORS) {
    const celsius = r?.[sensor] ?? null
    heat[sensor] = celsius === null || !current.hot ? 0 : nextHeat(heat[sensor] ?? 0, celsius, current.limits[sensor])
  }
}

// A reading's color now, the same in the widget and the settings window
export function heatLevel(sensor: Sensor) {
  return (heat as Partial<Record<Sensor, number>>)[sensor] ?? 0
}

// Peaks: the highest reading since SyncR started (main window only, lost on close), for
// temperatures and power (a 100 % load peak says nothing). Only for ticked readings: the others are
// read only while the settings window is open, so their peak would miss most of the time. Unticked
// or module off: that peak goes.
export const PEAK_SENSORS = ['cpuTemp', 'gpuTemp', 'gpuMemTemp', 'gpuPower'] as const
export type PeakSensor = (typeof PEAK_SENSORS)[number]
export const isPeakSensor = (sensor: Sensor): sensor is PeakSensor => (PEAK_SENSORS as readonly Sensor[]).includes(sensor)
let peaks: Partial<Record<PeakSensor, number>> = {} // replaced on each change (usePeaks)
const peakListeners = new Set<() => void>()

function setPeaks(next: Partial<Record<PeakSensor, number>>) {
  peaks = next
  peakListeners.forEach((listener) => listener())
}

function updatePeaks(r: HardwareReadings) {
  const next = nextPeaks(peaks, r, current.shown)
  if (next !== peaks) setPeaks(next)
}

// The peaks after this reading (the same object when none went up), counting only the ticked readings
export function nextPeaks(before: Partial<Record<PeakSensor, number>>, r: Pick<HardwareReadings, PeakSensor>, shown: readonly Sensor[]) {
  let next = before
  for (const sensor of PEAK_SENSORS) {
    const n = r[sensor]
    const peak = next[sensor]
    if (n === null || !shown.includes(sensor) || (peak !== undefined && n <= peak)) continue
    next = { ...next, [sensor]: n }
  }
  return next
}

function keepPeaks() {
  const kept = PEAK_SENSORS.filter((sensor) => peaks[sensor] !== undefined && current.on && current.shown.includes(sensor))
  if (kept.length !== Object.keys(peaks).length) setPeaks(Object.fromEntries(kept.map((sensor) => [sensor, peaks[sensor]])))
}

export const peaksAbout = () =>
  t('Next to each temperature and power: the highest since SyncR started, for the readings shown in the widget.')

// "Reset peaks" (the widget's menu and the settings window)
export function resetPeaks() {
  setPeaks({})
}

export function usePeaks() {
  return useSyncExternalStore(
    (listener) => {
      peakListeners.add(listener)
      return () => void peakListeners.delete(listener)
    },
    () => peaks,
  )
}

// A peak as text ("71.0 °C", "285 W"), "—" when there's none yet
export function peakText(sensor: PeakSensor, all: Partial<Record<PeakSensor, number>>) {
  const n = all[sensor]
  const value = n === undefined ? '—' : sensor === 'gpuPower' ? wattsText(n) : temperatureText(n)
  return t('max {value}', { value })
}

// The widget's hardware, in order, with their readings in the settings window's order
export const WIDGET_GROUPS = [
  { icon: 'cpu', sensors: ['cpuTemp', 'cpuLoad', 'cpuClock'] },
  { icon: 'gpu', sensors: ['gpuTemp', 'gpuMemTemp', 'gpuLoad', 'gpuPower', 'gpuClock', 'gpuMemClock', 'gpuMemUsed', 'gpuFan'] },
  { icon: 'memory', sensors: ['ram'] },
] as const

// What the widget shows for these readings (hardware_widget.rs draws it): the ticked readings this
// PC gives, under their hardware's name. Nothing to show: no widget.
function sendWidget(r: HardwareReadings | null) {
  if (!isTauri()) return
  const { place, onTop, locked, look, theme, frame, size, background, clickThrough } = { ...current, ...preview }
  const groups = !r || !current.on
    ? []
    : WIDGET_GROUPS.map(({ icon, sensors }) => ({
        title: groupName(icon, look === 'tiles' ? null : r), // tiles are narrow: "CPU", "GPU" (look B shows none)
        icon,
        rows: sensors.flatMap((sensor) => {
          const value = current.shown.includes(sensor) ? valueText(sensor, r) : null
          if (value === null) return []
          const temperature = (HOT_SENSORS as readonly Sensor[]).includes(sensor)
          return [{ label: sensorLabel(sensor, true), value, heat: heatLevel(sensor), bar: barFull(sensor, r), temperature }]
        }),
      })).filter((group) => group.rows.length > 0)
  const animations = animationsOn() // its fade under the mouse while clicks go through
  const content = groups.length > 0 ? { groups, place, onTop, locked, look, theme, frame, size, background, clickThrough, animations } : null
  invoke('hardware_widget', { content }).catch(console.error)
}
