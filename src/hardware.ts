import { useEffect, useState, useSyncExternalStore } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { read, write } from './localState'

// Hardware module (PC, Settings → Modules): temperatures, loads, clocks, fan and RAM, read by Rust
// (hardware.rs) and shown in a small widget on the desktop (later step). Its settings are kept on
// this device, never synced. This sends Rust the settings, at start and on every change. Off: Rust
// runs nothing and opens no library.

// The sensors, in the order the settings window lists them. Rust reads only the ones asked for.
export const SENSORS = ['cpuLoad', 'cpuClock', 'gpuTemp', 'gpuLoad', 'gpuClock', 'gpuMemClock', 'gpuFan', 'ram'] as const
export type Sensor = (typeof SENSORS)[number]

export interface HardwareSettings {
  on: boolean
  everyMs: number // how often the sensors are read
  shown: Sensor[] // what the widget shows
}

const KEY = 'syncr.hardware'
const DEFAULTS: HardwareSettings = { on: false, everyMs: 1000, shown: ['gpuTemp'] }
export const SPEEDS = [500, 1000, 2000, 5000]

let current: HardwareSettings = { ...DEFAULTS, ...read<Partial<HardwareSettings>>(KEY, {}) }
const listeners = new Set<() => void>()
let windowOpen = false // the settings window shows every sensor, so all are read while it's open

export function saveHardware(change: Partial<HardwareSettings>) {
  current = { ...current, ...change }
  write(KEY, current)
  listeners.forEach((listener) => listener())
  send()
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

// Main window only (main.tsx), once at start
export function startHardware() {
  if (current.on) send()
}

// As hardware.rs sends it (null: not asked for, or this PC can't give it)
export interface HardwareReadings {
  cpuName: string | null
  gpuName: string | null
  cpuLoad: number | null
  cpuClock: number | null
  gpuTemp: number | null
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
