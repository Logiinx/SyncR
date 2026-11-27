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
export type Room = 'grow' | 'keep' | 'none'

export interface SpotifySettings {
  on: boolean
  showAs: ShowAs // in the taskbar, left of the mouse battery, or floating on the desktop
  room: Room // the strip's room for ⏮ ⏭: made on hover (it grows to the left), always kept, or no ⏮ ⏭ at all (just ⏯)
  warned: boolean // "✕ quits SyncR, and Spotify's song with it" was shown once
}

// Names of the choices, for Settings → Spotify and the strip's right-click menu (spotifyMenu.tsx)
export const SHOW_AS: [ShowAs, () => string][] = [
  ['strip', () => t('Taskbar strip')],
  ['widget', () => t('Floating widget')],
]

const KEY = 'syncr.spotify'
const DEFAULTS: SpotifySettings = { on: false, showAs: 'strip', room: 'grow', warned: false }

// As saved on this device, also for the right-click menu (its own page, spotifyMenu.tsx)
export const storedSpotify = (): SpotifySettings => ({ ...DEFAULTS, ...read<Partial<SpotifySettings>>(KEY, {}) })

let current: SpotifySettings = storedSpotify()
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
  // The taskbar strip's words, in the app's language: the volume as it shows while the wheel turns
  // (Rust puts the number in). Its tooltip is the song's own title and artist, made in Rust.
  const sendWords = () => void invoke('spotify_words', { volumeLine: t('Volume {percent}%') }).catch(console.error)
  sendWords()
  onLanguageChange(sendWords)
  if (current.on) send()
  // The strip's right-click menu (widget_menu.rs): a changed option. "Spotify settings…" is App's
  // (listenSpotifyOpen).
  void listen<SpotifyMenuChoice>('spotify-menu', ({ payload }) => {
    if (payload.change) saveSpotify(payload.change)
  })
  // Settings → Animations changed (appearance.ts sets a class on the page): the buttons' fade too
  let animations = animationsOn()
  new MutationObserver(() => {
    if (animationsOn() === animations) return
    animations = animationsOn()
    if (current.on) send()
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
}

export interface SpotifyMenuChoice {
  change?: Partial<SpotifySettings>
  preview?: null // sent when the menu goes (for the Hardware widget's looks), nothing to undo here
}

// "Spotify settings…" in the strip's menu: App opens Settings on the Spotify section
export function listenSpotifyOpen(open: () => void) {
  if (!isTauri()) return () => {}
  const stop = listen('spotify-open', open)
  return () => void stop.then((unlisten) => unlisten())
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
