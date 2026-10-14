import { useEffect, useState } from 'react'
import ContextMenu from './ContextMenu'
import { forgetKey, getKey } from './crypto'
import { connect, connectedName, disconnect, finishConnect, isConnected } from './dropbox'
import PassphraseDialog from './PassphraseDialog'

// Cloud button in the title bar, left of the window controls.
// Not connected: click to connect Dropbox. Connected but locked (no passphrase on this
// device yet): shows a lock, click to enter the passphrase. Unlocked: click for a menu.
// TODO (step 5d): becomes the sync indicator (synced / syncing / waiting / error).
function SyncButton() {
  const [connected, setConnected] = useState(isConnected)
  const [unlocked, setUnlocked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [askPassphrase, setAskPassphrase] = useState(false)

  useEffect(() => {
    const refreshConnected = () => setConnected(isConnected())
    const refreshKey = () => getKey().then((key) => setUnlocked(key !== undefined))
    window.addEventListener('dropbox-change', refreshConnected)
    window.addEventListener('sync-key-change', refreshKey)
    refreshKey()

    // Just came back from the Dropbox sign-in: ask for the passphrase right away
    const justConnected = new URL(location.href).searchParams.has('code')
    finishConnect()
      .then((message) => {
        setError(message)
        if (justConnected && !message) refreshKey().then(() => setAskPassphrase(true))
      })
      .catch((e) => setError(String(e)))

    return () => {
      window.removeEventListener('dropbox-change', refreshConnected)
      window.removeEventListener('sync-key-change', refreshKey)
    }
  }, [])

  function onClick(e: React.MouseEvent) {
    setError(null)
    if (!connected) {
      connect()
      return
    }
    if (!unlocked) {
      setAskPassphrase(true)
      return
    }
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
    error ??
    (!connected
      ? 'Connect Dropbox'
      : locked
        ? 'Enter your passphrase to sync'
        : `Dropbox connected${name ? ` (${name})` : ''}`)

  return (
    <>
      <button
        className={`sync-button${connected ? ' connected' : ''}${error ? ' error' : ''}`}
        onClick={onClick}
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
        </svg>
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[{ label: 'Disconnect Dropbox', danger: true, onClick: onDisconnect }]}
        />
      )}
      {askPassphrase && unlocked === false && connected && (
        <PassphraseDialog onClose={() => setAskPassphrase(false)} />
      )}
    </>
  )
}

export default SyncButton
