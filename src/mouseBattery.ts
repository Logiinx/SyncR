import { useEffect, useState, useSyncExternalStore } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { read, write } from './localState'
import { percentText, subscribe as onLanguageChange, t } from './i18n'
import { clockTime } from './dates'

// Mouse battery module (PC, Settings → Hardware): its settings, kept on this device, never synced.
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
  if (!current.on) saveLowAlert(null)
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
  saveLowAlert(null) // a card from the last run: the first check shows it again if still low
  if (current.on) send()
  // The strip's tooltip, in the app's language: after each check and when the language changes
  let latest: MouseBatteryStatus | null = null
  const sendTip = () => {
    if (latest) invoke('mouse_battery_tip', { text: tipText(latest) }).catch(console.error)
  }
  void listen<MouseBatteryStatus>('mouse-battery', (event) => {
    latest = event.payload
    sendTip()
    checkLow(event.payload)
  })
  onLanguageChange(sendTip)
}

// The low battery card in the pop-up (popupWindow.ts, BatteryCard.tsx): set here by the main
// window, kept in localStorage, which the pop-up reads too and follows through "storage" events.
// Once per discharge: when it first gets to the low level (also at SyncR's start if it's already
// low), again only after a charge above that level. It goes when charging starts, when the level
// is set below the percent, with Done, or faded (Settings → Alerts → Emails' time).
export interface LowAlert {
  percent: number
  at: number // when it first showed (ms)
}
export const LOW_ALERT_KEY = 'syncr.mouseBattery.alert'
export const LOW_ALERT_ID = 'mouse-battery-low' // its id in the pop-up's messages
let armed = true // memory only: a new start warns again

export const loadLowAlert = () => read<LowAlert | null>(LOW_ALERT_KEY, null)

function saveLowAlert(alert: LowAlert | null) {
  if (JSON.stringify(alert) === JSON.stringify(loadLowAlert())) return
  write(LOW_ALERT_KEY, alert)
  window.dispatchEvent(new Event('mouse-battery-alert-change')) // this window; others get "storage"
}

function checkLow({ last, answering }: MouseBatteryStatus) {
  if (!current.on || !last || !answering) return // no answer: nothing new to go by
  const alert = loadLowAlert()
  if (last.charging) {
    if (last.percent > current.low) armed = true
    saveLowAlert(null)
  } else if (last.percent > current.low) {
    saveLowAlert(null)
  } else if (alert) {
    saveLowAlert({ ...alert, percent: last.percent }) // still showing: its percent follows
  } else if (armed) {
    armed = false
    saveLowAlert({ percent: last.percent, at: Date.now() })
  }
}

// Done or faded in the pop-up: the card goes, and stays gone until a charge above the level
export function closeLowAlert() {
  saveLowAlert(null)
}

// The card to show, kept current (also from the other window)
export function useLowAlert() {
  const [alert, setAlert] = useState(loadLowAlert)
  useEffect(() => {
    const refresh = () => setAlert(loadLowAlert())
    const onStorage = (e: StorageEvent) => e.key === LOW_ALERT_KEY && refresh()
    window.addEventListener('mouse-battery-alert-change', refresh)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('mouse-battery-alert-change', refresh)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  return alert
}

// "Teevolution Terra Pro / 93 %, charging / Last answer: 14:32", one per line (Windows' tooltip)
export function tipText({ last, answering }: MouseBatteryStatus) {
  const lines = [t('Teevolution Terra Pro')]
  if (last) {
    const percent = last.percent
    lines.push(last.charging && answering ? t('{percent}%, charging', { percent }) : percentText(percent))
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

// The latest check, for Settings → Hardware (null: off, or not known yet)
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
