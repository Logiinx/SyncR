import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Check } from 'lucide-react'
import { getStatus, startAutoSync, stopAutoSync, subscribe, syncByUser } from './autoSync'
import { currentZoom } from './appearance'
import ContextMenu from './ContextMenu'
import { forgetKey, getKey } from './crypto'
import { connect, disconnect, finishConnect, isConnected } from './dropbox'
import PassphraseDialog from './PassphraseDialog'
import type { SyncResult } from './sync'

// "2 sent · 1 received · 1 conflict copy" (shown after a ✓)
function describe(r: SyncResult) {
  const parts = [
    r.uploaded && `${r.uploaded} sent`,
    r.downloaded && `${r.downloaded} received`,
    r.deleted && `${r.deleted} deleted`,
    r.conflicts && `${r.conflicts} conflict ${r.conflicts === 1 ? 'copy' : 'copies'}`,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Up to date'
}

// A short message under the button. `ok`: the result of a sync the user started (gets a ✓).
interface Message {
  text: string
  ok: boolean
  place: { right: number; top: number }
  leaving: boolean // fading out
}

// Right-aligned under the button (screen pixels ÷ zoom = page pixels)
function placeUnder(button: HTMLElement) {
  const rect = button.getBoundingClientRect()
  const zoom = currentZoom()
  return { right: (window.innerWidth - rect.right) / zoom, top: rect.bottom / zoom + 6 }
}

// Cloud button in the title bar, left of the window controls. Also the sync indicator.
// Not connected: click to connect Dropbox. Connected but locked (no passphrase on this
// device yet): shows a lock, click to enter the passphrase. Unlocked: click = sync now,
// right-click (long press on a phone) = menu.
// "just now", "5 min ago", "3 h ago", "yesterday", otherwise "14-10-2026"
function timeAgo(time: number) {
  const minutes = Math.floor((Date.now() - time) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`
  const date = new Date(time)
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return 'yesterday'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`
}

// Drawn twice: a thicker copy in the background color first, so a gap separates it from the cloud
const padlock = (
  <>
    <rect x="15" y="16" width="8" height="6" rx="1.2" />
    <path d="M16.75 16v-1.5a2.25 2.25 0 0 1 4.5 0V16" />
  </>
)

function SyncButton() {
  const [connected, setConnected] = useState(isConnected)
  const [unlocked, setUnlocked] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [askPassphrase, setAskPassphrase] = useState(false)
  const [message, setMessage] = useState<Message | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const { status, errorMessage, lastSuccessAt } = useSyncExternalStore(subscribe, getStatus)
  // Hover info under the button (mouse only: phones can't hover)
  const [hover, setHover] = useState<{ right: number; top: number } | null>(null)
  const hoverTimer = useRef<number | undefined>(undefined)
  const [, setTick] = useState(0)

  // While the hover info is open, "2 min ago" keeps counting
  useEffect(() => {
    if (!hover) return
    const timer = window.setInterval(() => setTick((n) => n + 1), 30_000)
    return () => window.clearInterval(timer)
  }, [hover])

  function onMouseEnter(e: React.MouseEvent) {
    if (!matchMedia('(hover: hover)').matches) return
    const place = placeUnder(e.currentTarget as HTMLElement)
    hoverTimer.current = window.setTimeout(() => setHover(place), 400)
  }

  function hideHover() {
    window.clearTimeout(hoverTimer.current)
    setHover(null)
  }

  function showMessage(text: string, ok = false) {
    if (buttonRef.current) setMessage({ text, ok, place: placeUnder(buttonRef.current), leaving: false })
  }

  // Messages fade out after 3 s (other messages, e.g. errors, are longer to read: 5 s)
  const messageKey = message && !message.leaving ? message : null
  useEffect(() => {
    if (!messageKey) return
    const fadeOut = window.setTimeout(
      () => setMessage((m) => m && { ...m, leaving: true }),
      messageKey.ok ? 3000 : 5000,
    )
    return () => window.clearTimeout(fadeOut)
  }, [messageKey])

  useEffect(() => {
    const refreshConnected = () => setConnected(isConnected())
    const refreshKey = () => getKey().then((key) => setUnlocked(key !== undefined))
    const onNotice = (e: Event) => showMessage((e as CustomEvent<string>).detail)
    window.addEventListener('dropbox-change', refreshConnected)
    window.addEventListener('sync-key-change', refreshKey)
    window.addEventListener('sync-notice', onNotice)
    refreshKey()

    // Just came back from the Dropbox sign-in: ask for the passphrase right away
    const justConnected = new URL(location.href).searchParams.has('code')
    finishConnect()
      .then((error) => {
        setSignInError(error)
        if (justConnected && !error) refreshKey().then(() => setAskPassphrase(true))
      })
      .catch((e) => setSignInError(String(e)))

    return () => {
      window.removeEventListener('dropbox-change', refreshConnected)
      window.removeEventListener('sync-key-change', refreshKey)
      window.removeEventListener('sync-notice', onNotice)
    }
  }, [])

  // Sync runs by itself while connected and unlocked
  useEffect(() => {
    if (!connected || !unlocked) return
    startAutoSync()
    return stopAutoSync
  }, [connected, unlocked])

  async function onClick() {
    hideHover()
    setSignInError(null)
    if (!connected) connect()
    else if (!unlocked) setAskPassphrase(true)
    else {
      const result = await syncByUser()
      if (result) showMessage(describe(result), true)
    }
  }

  function onRightClick(e: React.MouseEvent) {
    e.preventDefault()
    hideHover()
    if (!connected) return
    const rect = e.currentTarget.getBoundingClientRect()
    // Right-aligned under the button. 170 = menu width in page pixels, × zoom for screen pixels
    setMenu({ x: rect.right - 170 * currentZoom(), y: rect.bottom })
  }

  async function onDisconnect() {
    await disconnect()
    await forgetKey()
  }

  const locked = connected && !unlocked
  const ago = lastSuccessAt ? timeAgo(lastSuccessAt) : null
  // Hover info: what's going on, then a dim hint about what a click does
  const [info, hint] = signInError
    ? [`Dropbox sign-in failed: ${signInError}`, 'Click to try again']
    : !connected
      ? ['Dropbox not connected', 'Click to connect']
      : locked
        ? ['Passphrase needed', 'Click to enter it']
        : (
            {
              off: ['Dropbox connected', ''],
              synced: [`Synced${ago ? ` · ${ago}` : ''}`, ''],
              syncing: ['Syncing…', ''],
              pending: ['Changes waiting to sync', ''],
              offline: [`Offline${ago ? ` · last synced ${ago}` : ''}`, "Changes will sync when you're back online"],
              error: [`Sync error: ${errorMessage}`, 'Retrying every minute. Click to try now.'],
            } as const
          )[status]

  return (
    <>
      <button
        ref={buttonRef}
        // The status ("synced", "error", …) is also a class, for the colors
        className={`sync-button${connected ? ' connected' : ''} ${status}`}
        onClick={onClick}
        onContextMenu={onRightClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={hideHover}
        aria-label={info}
      >
        <svg viewBox="0 0 24 24">
          <path className="cloud" d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
          {/* Status in the corner: a colored dot (green synced, blue waiting, red error), a turning
              ring while syncing, an empty dot offline, an orange padlock when locked */}
          {signInError && !connected && <circle className="badge error" cx="19" cy="18" r="3.25" />}
          {locked && (
            <>
              <g className="lock-gap">{padlock}</g>
              <g className="lock">{padlock}</g>
            </>
          )}
          {!locked && connected && ['synced', 'pending', 'error', 'offline'].includes(status) && (
            <circle className={`badge ${status}`} cx="19" cy="18" r="3.25" />
          )}
          {!locked && connected && status === 'syncing' && (
            <>
              <circle className="ring-gap" cx="19" cy="18" r="4.25" />
              <circle className="ring" cx="19" cy="18" r="2.6" />
            </>
          )}
        </svg>
      </button>
      {hover && !menu && !message && (
        <div className="sync-info" style={hover}>
          <div>{info}</div>
          <div className="sync-info-hint">{hint || 'Click to sync · right-click for more'}</div>
        </div>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            ...(unlocked ? [{ label: 'Sync now', onClick }] : []),
            { label: 'Disconnect Dropbox', danger: true, onClick: onDisconnect },
          ]}
        />
      )}
      {message && (
        <div
          className={message.leaving ? 'sync-message leaving' : 'sync-message'}
          style={message.place}
          onAnimationEnd={() => message.leaving && setMessage(null)}
        >
          {message.ok && <Check size={14} className="sync-message-ok" />}
          {message.text}
        </div>
      )}
      {askPassphrase && !unlocked && connected && <PassphraseDialog onClose={() => setAskPassphrase(false)} />}
    </>
  )
}

export default SyncButton
