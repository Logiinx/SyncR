import { useEffect, useState, useSyncExternalStore } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { animationsOn } from './animations'
import { read, write } from './localState'
import { subscribe as onLanguageChange, t } from './i18n'

// Spotify module (PC, Settings → Spotify): what Spotify plays, as a strip in the taskbar or a
// floating widget. Its settings are kept on this device, never synced. The reading is in Rust
// (spotify.rs, from Windows' media info: no Spotify sign-in): this sends it the settings, at start
// and on every change. Off: Rust reads nothing.

export type ShowAs = 'strip' | 'widget'
export type Room = 'grow' | 'keep'

export interface SpotifySettings {
  on: boolean
  showAs: ShowAs // in the taskbar, left of the mouse battery, or floating on the desktop
  room: Room // the strip's room for ⏮ ⏭: made on hover (it grows to the left) or always kept
  warned: boolean // "✕ quits SyncR, and Spotify's song with it" was shown once
}

const KEY = 'syncr.spotify'
const DEFAULTS: SpotifySettings = { on: false, showAs: 'strip', room: 'grow', warned: false }

let current: SpotifySettings = { ...DEFAULTS, ...read<Partial<SpotifySettings>>(KEY, {}) }
const listeners = new Set<() => void>()

export function saveSpotify(change: Partial<SpotifySettings>) {
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

export function useSpotify() {
  return useSyncExternalStore(subscribe, () => current)
}

function send() {
  if (!isTauri()) return
  const { on, showAs, room } = current
  invoke('spotify_config', { config: { on, showAs, room, animations: animationsOn() } }).catch(console.error)
}

// Main window only (main.tsx), once at start
export function startSpotify() {
  if (!isTauri()) return
  // The taskbar strip's tooltip, in the app's language: after each song change and when the
  // language changes (listening before the settings go: the first song comes as an event)
  let latest: Song | null = null
  const sendTip = () => {
    if (latest) invoke('spotify_tip', { text: tipText(latest) }).catch(console.error)
  }
  void listen<Song | null>('spotify', (event) => {
    latest = event.payload
    sendTip()
  }).then(() => current.on && send())
  onLanguageChange(sendTip)
  // Settings → Animations changed (appearance.ts sets a class on the page): the buttons' fade too
  let animations = animationsOn()
  new MutationObserver(() => {
    if (animationsOn() === animations) return
    animations = animationsOn()
    if (current.on) send()
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
}

// "Title / Artist / Album: …", one per line (Windows' tooltip)
export function tipText({ title, artist, album }: Song) {
  const lines = [title]
  if (artist) lines.push(artist)
  if (album) lines.push(t('Album: {album}', { album }))
  return lines.join('\n')
}

// As spotify.rs sends it (null: Spotify closed, or nothing loaded)
export interface Song {
  title: string
  artist: string
  album: string
  playing: boolean
  cover: string | null // a data: address
}

// The song now, for Settings → Spotify (undefined: not known yet; null: nothing playing)
export function useSpotifySong(on: boolean) {
  const [song, setSong] = useState<Song | null | undefined>(undefined)
  useEffect(() => {
    setSong(undefined)
    if (!isTauri() || !on) return
    let gone = false
    // Listening first, then asking: a change in between can't be missed (just turned on, the
    // first reading comes as an event)
    const stop = listen<Song | null>('spotify', (event) => setSong(event.payload))
    void stop.then(() => invoke<Song | null>('spotify_status')).then((now) => !gone && setSong((was) => (was === undefined ? now : was)), console.error)
    return () => {
      gone = true
      void stop.then((unlisten) => unlisten())
    }
  }, [on])
  return song
}
