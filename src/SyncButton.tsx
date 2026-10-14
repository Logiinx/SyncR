import { useEffect, useState, useSyncExternalStore } from 'react'
import { getStatus, startAutoSync, stopAutoSync, subscribe, syncByUser } from './autoSync'
import ContextMenu from './ContextMenu'
import { forgetKey, getKey } from './crypto'
import { connect, connectedName, disconnect, finishConnect, isConnected } from './dropbox'
import PassphraseDialog from './PassphraseDialog'
import type { SyncResult } from './sync'

// "Synced. 2 sent, 1 received, 1 conflict copy created."
function describe(r: SyncResult) {
  const parts = [
    r.uploaded && `${r.uploaded} sent`,
    r.downloaded && `${r.downloaded} received`,
    r.deleted && `${r.deleted} deleted`,
    r.conflicts && `${r.conflicts} conflict ${r.conflicts === 1 ? 'copy' : 'copies'} created`,
  ].filter(Boolean)
  return parts.length ? `Synced. ${parts.join(', ')}.` : 'Synced. Nothing changed.'
}

// Cloud button in the title bar, left of the window controls. Also the sync indicator.
// Not connected: click to connect Dropbox. Connected but locked (no passphrase on this
// device yet): shows a lock, click to enter the passphrase. Unlocked: click = sync now,
// right-click (long press on a phone) = menu.
function SyncButton() {
  const [connected, setConnected] = useState(isConnected)
  const [unlocked, setUnlocked] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [askPassphrase, setAskPassphrase] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const { status, errorMessage } = useSyncExternalStore(subscribe, getStatus)

  // Messages disappear after a few seconds
  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(() => setMessage(null), 5000)
    return () => window.clearTimeout(timer)
  }, [message])

  useEffect(() => {
    const refreshConnected = () => setConnected(isConnected())
    const refreshKey = () => getKey().then((key) => setUnlocked(key !== undefined))
    const onNotice = (e: Event) => setMessage((e as CustomEvent<string>).detail)
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
    setSignInError(null)
    if (!connected) connect()
    else if (!unlocked) setAskPassphrase(true)
    else {
      const result = await syncByUser()
      if (result) setMessage(describe(result))
    }
  }

  function onRightClick(e: React.MouseEvent) {
    e.preventDefault()
    if (!connected) return
    const rect = e.currentTarget.getBoundingClientRect()
    setMenu({ x: rect.right - 170, y: rect.bottom })
  }

  async function onDisconnect() {
    await disconnect()
    await forgetKey()
  }

  const name = connectedName()
  const locked = connected && !unlocked
  const title =
    signInError ??
    (!connected
      ? 'Connect Dropbox'
      : locked
        ? 'Enter your passphrase to sync'
        : {
            off: 'Dropbox connected',
            synced: `Synced${name ? ` with ${name}` : ''}. Click to sync now, right-click for more.`,
            syncing: 'Syncing…',
            pending: 'Changes waiting to sync',
            offline: "Offline. Changes will sync when you're back online.",
            error: `Sync error: ${errorMessage}. Retrying every minute. Click to try now.`,
          }[status])

  return (
    <>
      <button
        // The status ("synced", "error", …) is also a class, for the colors
        className={`sync-button${connected ? ' connected' : ''}${signInError ? ' error' : ''} ${status}`}
        onClick={onClick}
        onContextMenu={onRightClick}
        title={title}
      >
        <svg viewBox="0 0 16 16">
          <path d="M4.5 12.5h7.25a3 3 0 0 0 .4-5.97A4.25 4.25 0 0 0 3.9 7.6 2.5 2.5 0 0 0 4.5 12.5z" />
          {locked && (
            <g className="lock">
              <rect x="9.5" y="10.5" width="5.5" height="4.5" rx="0.75" />
              <path d="M10.75 10.5V9.25a1.5 1.5 0 0 1 3 0v1.25" />
            </g>
          )}
          {/* Small mark inside the cloud: ✓ synced, ● waiting/offline, ! error */}
          {!locked && connected && status === 'synced' && <path className="mark" d="M6.1 9.4l1.3 1.3 2.5-2.6" />}
          {!locked && connected && (status === 'pending' || status === 'offline') && (
            <circle className="dot" cx="8" cy="9.5" r="1.1" />
          )}
          {!locked && connected && status === 'error' && (
            <g className="mark">
              <path d="M8 7.6v1.9" />
              <circle className="dot" cx="8" cy="11" r="0.4" />
            </g>
          )}
        </svg>
      </button>
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
      {message && <div className="sync-message">{message}</div>}
      {askPassphrase && !unlocked && connected && <PassphraseDialog onClose={() => setAskPassphrase(false)} />}
    </>
  )
}

export default SyncButton
