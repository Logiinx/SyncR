import { useEffect, useState, useSyncExternalStore } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { read, write } from './localState'
import { subscribe as onLanguageChange, t } from './i18n'
import { clockTime } from './dates'

// Mouse battery module (PC, Settings → Modules): its settings, kept on this device, never synced.
// The checks and the taskbar strip are in Rust (mouse_battery.rs, strip.rs): this sends them the
// settings, at start and on every change. Off: Rust runs nothing and opens no device.

export interface MouseBatterySettings {
  on: boolean // shows the mouse and its percent inside the taskbar, left of the notification area
  low: number // at or below this percent, the number turns red
  warned: boolean // "✕ quits SyncR, and the battery with it" was shown once
}

const KEY = 'syncr.mouseBattery'
const DEFAULTS: MouseBatterySettings = { on: false, low: 15, warned: false }
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
  const { on, low } = current
  invoke('mouse_battery_config', { config: { on, low } }).catch(console.error)
}

// Main window only (main.tsx), once at start
export function startMouseBattery() {
  if (!isTauri()) return
  if (current.on) send()
  // The strip's tooltip, in the app's language: after each check and when the language changes
  let latest: MouseBatteryStatus | null = null
  const sendTip = () => {
    if (latest) invoke('mouse_battery_tip', { text: tipText(latest) }).catch(console.error)
  }
  void listen<MouseBatteryStatus>('mouse-battery', (event) => {
    latest = event.payload
    sendTip()
  })
  onLanguageChange(sendTip)
}

// "Teevolution Terra Pro / 93 %, charging / Last answer: 14:32", one per line (Windows' tooltip)
export function tipText({ last, answering }: MouseBatteryStatus) {
  const lines = [t('Teevolution Terra Pro')]
  if (last) {
    const percent = last.percent
    lines.push(last.charging && answering ? t('{percent}%, charging', { percent }) : t('{percent}%', { percent }))
    lines.push(t('Last answer: {time}', { time: clockTime(last.at) }))
  } else lines.push(t('No answer yet'))
  if (last && !answering) lines.push(t('Asleep or out of reach'))
  return lines.join('\n')
}

// A click on the taskbar strip (strip.rs): App opens Settings on the Mouse battery window
export function listenMouseBatteryOpen(open: () => void) {
  if (!isTauri()) return () => {}
  const stop = listen('mouse-battery-open', open)
  return () => void stop.then((unlisten) => unlisten())
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
