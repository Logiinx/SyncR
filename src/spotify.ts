import { useEffect, useState, useSyncExternalStore } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { read, write } from './localState'

// Spotify module (PC, Settings → Spotify): what Spotify plays, as a strip in the taskbar or a
// floating widget. Its settings are kept on this device, never synced. The reading is in Rust
// (spotify.rs, from Windows' media info: no Spotify sign-in): this sends it the settings, at start
// and on every change. Off: Rust reads nothing.

export type ShowAs = 'strip' | 'widget'

export interface SpotifySettings {
  on: boolean
  showAs: ShowAs // in the taskbar, left of the mouse battery, or floating on the desktop
  warned: boolean // "✕ quits SyncR, and Spotify's song with it" was shown once
}

const KEY = 'syncr.spotify'
const DEFAULTS: SpotifySettings = { on: false, showAs: 'strip', warned: false }

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
  const { on, showAs } = current
  invoke('spotify_config', { config: { on, showAs } }).catch(console.error)
}

// Main window only (main.tsx), once at start
export function startSpotify() {
  if (isTauri() && current.on) send()
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
