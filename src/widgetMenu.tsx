import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { invoke, isTauri } from '@tauri-apps/api/core'
import './index.css'
import { animationsOn, startClosingAnimations, TIMING } from './animations'
import { applyAppearance, loadAppearance } from './appearance'
import { useLanguage } from './i18n'
import HardwareMenu from './hardwareMenu'
import SpotifyMenu from './spotifyMenu'

// The right-click menu of SyncR's windows outside the app (the Hardware widget, the Spotify
// strip and widget): a page of its own in a see-through window over the whole monitor (widget_menu.rs). The
// window is made hidden as soon as the mouse is over one of them, so a right-click shows the menu
// at once; it's removed when the menu closes, or a few seconds after the mouse leaves without a
// right-click. The app's own menu (ContextMenu), so it looks and behaves the same. Whose menu it
// is comes with each right-click: one window serves them all.

// Whose menu, where to open: the mouse, and the window's size, in screen pixels
interface OpenAt {
  for: 'hardware' | 'spotify-strip' | 'spotify-widget'
  x: number
  y: number
  w: number
  h: number
}
declare global {
  interface Window {
    openWidgetMenu?: (at: OpenAt) => void // called by Rust on a right-click (show in widget_menu.rs)
  }
}

// What each owner's menu gets: where to open (CSS pixels), a way to tell Rust (and through it the
// main window) a choice, and closing
export interface MenuProps<Choice> {
  x: number
  y: number
  send: (action: 'choice' | 'settings', choice?: Choice) => Promise<void>
  onClose: () => void
}

const send = async (action: string, choice?: unknown) => {
  if (isTauri()) await invoke('widget_menu', { action, choice }).catch(console.error)
}

// The window may still be getting the monitor's size: the menu is placed once it has it (it keeps
// itself inside the window), or after a second whatever happens, so it always shows
const sized = (at: OpenAt) => Math.abs(innerWidth * devicePixelRatio - at.w) <= 2 && Math.abs(innerHeight * devicePixelRatio - at.h) <= 2

function WidgetMenu() {
  useLanguage()
  const [at, setAt] = useState<OpenAt | null>(null)
  const [ready, setReady] = useState(false)

  // Loaded and waiting, hidden. Right-clicked: the app's look is read again (it may have changed
  // while it waited), and the owner's menu is made fresh, so it reads its settings again too
  useEffect(() => {
    window.openWidgetMenu = (next) => {
      applyAppearance(loadAppearance())
      setAt(next)
    }
    void send('loaded')
    return () => {
      window.openWidgetMenu = undefined
    }
  }, [])

  useEffect(() => {
    if (!at || ready) return
    const check = () => sized(at) && setReady(true)
    check()
    const late = setTimeout(() => setReady(true), 1000)
    addEventListener('resize', check)
    return () => {
      clearTimeout(late)
      removeEventListener('resize', check)
    }
  }, [at, ready])
  // Shown once drawn (the next frame; a hidden page may get none, so at most 100 ms later)
  useEffect(() => {
    if (!ready) return
    let shown = false
    const show = () => {
      if (!shown) void send('ready')
      shown = true
    }
    requestAnimationFrame(show)
    const late = setTimeout(show, 100)
    return () => clearTimeout(late)
  }, [ready])

  // Closing: the menu's closing animation, then the window goes. Another window taking the
  // focus (a click on another monitor, Alt+Tab) closes it too.
  const [closing, setClosing] = useState(false)
  useEffect(() => {
    if (!closing) return
    const done = setTimeout(() => void send('close'), animationsOn() ? TIMING.closeSmall : 0)
    return () => clearTimeout(done)
  }, [closing])
  useEffect(() => {
    if (!at) return
    const close = () => setClosing(true)
    addEventListener('blur', close)
    return () => removeEventListener('blur', close)
  }, [at])

  if (!at || !ready || closing) return null
  const props = { x: at.x / devicePixelRatio, y: at.y / devicePixelRatio, send, onClose: () => setClosing(true) }
  return at.for === 'hardware' ? <HardwareMenu {...props} /> : <SpotifyMenu {...props} widget={at.for === 'spotify-widget'} />
}

applyAppearance(loadAppearance()) // the app's scale, font and animations setting
startClosingAnimations()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WidgetMenu />
  </StrictMode>,
)
