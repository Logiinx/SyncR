import { useEffect, useState, useSyncExternalStore } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { decimal, percentText, t } from './i18n'
import { read, write } from './localState'

// Hardware module (PC, Settings → Modules): temperatures, loads, clocks, fan and RAM, read by Rust
// (hardware.rs) and shown in a small widget on the desktop (later step). Its settings are kept on
// this device, never synced. This sends Rust the settings, at start and on every change. Off: Rust
// runs nothing and opens no library.

// The sensors, in the order the settings window lists them. Rust reads only the ones asked for.
export const SENSORS = ['cpuTemp', 'cpuLoad', 'cpuClock', 'gpuTemp', 'gpuMemTemp', 'gpuLoad', 'gpuClock', 'gpuMemClock', 'gpuFan', 'ram'] as const
export type Sensor = (typeof SENSORS)[number]

export interface HardwareSettings {
  on: boolean
  everyMs: number // how often the sensors are read
  shown: Sensor[] // what the widget shows
  place: [number, number] | null // the widget's top left on screen (pixels), once it was placed or moved
}

const KEY = 'syncr.hardware'
const DEFAULTS: HardwareSettings = { on: false, everyMs: 1000, shown: ['cpuTemp', 'gpuTemp'], place: null }
export const SPEEDS = [500, 1000, 2000, 5000]

let current: HardwareSettings = { ...DEFAULTS, ...read<Partial<HardwareSettings>>(KEY, {}) }
const listeners = new Set<() => void>()
let windowOpen = false // the settings window shows every sensor, so all are read while it's open

export function saveHardware(change: Partial<HardwareSettings>) {
  current = { ...current, ...change }
  write(KEY, current)
  listeners.forEach((listener) => listener())
  send()
  if (!current.on) sendWidget(null) // no more readings come: closed now
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

function send() {
  if (!isTauri()) return
  const { on, everyMs } = current
  const sensors = windowOpen ? [...SENSORS] : current.shown
  invoke('hardware_config', { config: { on, everyMs, sensors } }).catch(console.error)
}

// Main window only (main.tsx), once at start. Every reading updates the widget (a changed tick or
// speed reads again at once, so the widget follows); where the user drags it is saved here.
export function startHardware() {
  if (!isTauri()) return
  void listen<HardwareReadings>('hardware', (event) => sendWidget(event.payload))
  void listen<[number, number]>('hardware-widget-moved', (event) => {
    current = { ...current, place: event.payload }
    write(KEY, current)
  })
  if (current.on) send()
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
  gpuClock: number | null
  gpuMemClock: number | null
  gpuFan: number | null
  gpuFanRpm: number | null
  ramUsed: number | null
  ramTotal: number | null
  at: number
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
    case 'gpuFan':
      return t('Fan')
    case 'ram':
      return t('RAM used')
  }
}

// A reading as text, the same in the settings window and the widget; null when this PC can't give it
export function valueText(sensor: Sensor, r: HardwareReadings): string | null {
  const temperature = (n: number | null) => (n === null ? null : t('{n} °C', { n: decimal(n, 1) }))
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
    case 'gpuFan':
      if (r.gpuFan === null) return null
      return r.gpuFanRpm === null ? percent(r.gpuFan) : t('{percent}% · {rpm} RPM', { percent: Math.round(r.gpuFan), rpm: decimal(r.gpuFanRpm, 0) })
    case 'ram':
      if (r.ramUsed === null || r.ramTotal === null) return null
      return t('{used} / {total} GB', { used: decimal(r.ramUsed / GB, 1), total: decimal(r.ramTotal / GB, 1) })
  }
}

// The widget's hardware, in order, with their readings in the settings window's order
const WIDGET_GROUPS = [
  { icon: 'cpu', sensors: ['cpuTemp', 'cpuLoad', 'cpuClock'] },
  { icon: 'gpu', sensors: ['gpuTemp', 'gpuMemTemp', 'gpuLoad', 'gpuClock', 'gpuMemClock', 'gpuFan'] },
  { icon: 'memory', sensors: ['ram'] },
] as const

// What the widget shows for these readings (hardware_widget.rs draws it): the ticked readings this
// PC gives, under their hardware's name. Nothing to show: no widget.
function sendWidget(r: HardwareReadings | null) {
  if (!isTauri()) return
  const title = (icon: string) => {
    if (icon === 'cpu') return r?.cpuName ? shortCpuName(r.cpuName) : t('CPU')
    if (icon === 'gpu') return r?.gpuName ? shortGpuName(r.gpuName) : t('GPU')
    return t('Memory')
  }
  const groups = !r || !current.on
    ? []
    : WIDGET_GROUPS.map(({ icon, sensors }) => ({
        title: title(icon),
        icon,
        rows: sensors.flatMap((sensor) => {
          const value = current.shown.includes(sensor) ? valueText(sensor, r) : null
          return value === null ? [] : [[sensorLabel(sensor, true), value]]
        }),
      })).filter((group) => group.rows.length > 0)
  const content = groups.length > 0 ? { groups, place: current.place } : null
  invoke('hardware_widget', { content }).catch(console.error)
}
