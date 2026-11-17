import { useEffect, useState, useSyncExternalStore } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { read, write } from './localState'
import { subscribe as onLanguageChange, t } from './i18n'

// Mouse battery module (PC, Settings → Modules): its settings, kept on this device, never synced.
// The checks and the tray icon are in Rust (mouse_battery.rs): this sends them the settings and
// the tray's words, at start and on every change. Off: Rust runs nothing and opens no device.

export interface MouseBatterySettings {
  on: boolean
  tray: boolean // its own tray icon with the number in it
  low: number // at or below this percent, the number turns red
  warned: boolean // "✕ quits SyncR, and the battery with it" was shown once
}

const KEY = 'syncr.mouseBattery'
const DEFAULTS: MouseBatterySettings = { on: false, tray: true, low: 15, warned: false }
export const LOW_LEVELS = [5, 10, 15, 20, 25, 30, 40, 50]

let current: MouseBatterySettings = { ...DEFAULTS, ...read<Partial<MouseBatterySettings>>(KEY, {}) }
const listeners = new Set<() => void>()

export function saveMouseBattery(change: Partial<MouseBatterySettings>) {
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

export function useMouseBattery() {
  return useSyncExternalStore(subscribe, () => current)
}

function send() {
  if (!isTauri()) return
  const { on, tray, low } = current
  const config = { on, tray, low, tip: t('Mouse battery: {percent}%'), tipWaiting: t('Mouse battery: no answer yet') }
  invoke('mouse_battery_config', { config }).catch(console.error)
}

// Main window only (main.tsx), once at start
export function startMouseBattery() {
  if (!isTauri()) return
  if (current.on) send()
  onLanguageChange(() => current.on && send())
}

// As mouse_battery.rs sends it
export interface MouseBatteryStatus {
  last: { percent: number; charging: boolean; millivolts: number; at: number } | null
  answering: boolean // the last check got an answer
}

// The latest check, for the settings window (null: off, or not known yet)
export function useMouseBatteryStatus(on: boolean) {
  const [status, setStatus] = useState<MouseBatteryStatus | null>(null)
  useEffect(() => {
    setStatus(null)
    if (!isTauri() || !on) return
    let gone = false
    invoke<MouseBatteryStatus>('mouse_battery_status').then((now) => !gone && setStatus(now), console.error)
    const stop = listen<MouseBatteryStatus>('mouse-battery', (event) => setStatus(event.payload))
    return () => {
      gone = true
      void stop.then((unlisten) => unlisten())
    }
  }, [on])
  return status
}
