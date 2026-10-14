import { useEffect, useState } from 'react'
import ContextMenu from './ContextMenu'
import { connect, connectedName, disconnect, finishConnect, isConnected } from './dropbox'

// Cloud button in the title bar, left of the window controls.
// Not connected: click to connect Dropbox. Connected: click for a menu.
// TODO (step 5d): becomes the sync indicator (synced / syncing / waiting / error).
function SyncButton() {
  const [connected, setConnected] = useState(isConnected)
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const refresh = () => setConnected(isConnected())
    window.addEventListener('dropbox-change', refresh)
    finishConnect()
      .then(setError)
      .catch((e) => setError(String(e)))
    return () => window.removeEventListener('dropbox-change', refresh)
  }, [])

  function onClick(e: React.MouseEvent) {
    setError(null)
    if (!connected) {
      connect()
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    setMenu({ x: rect.right - 170, y: rect.bottom })
  }

  const name = connectedName()
  const title = error ?? (connected ? `Dropbox connected${name ? ` (${name})` : ''}` : 'Connect Dropbox')

  return (
    <>
      <button
        className={`sync-button${connected ? ' connected' : ''}${error ? ' error' : ''}`}
        onClick={onClick}
        title={title}
      >
        <svg viewBox="0 0 16 16">
          <path d="M4.5 12.5h7.25a3 3 0 0 0 .4-5.97A4.25 4.25 0 0 0 3.9 7.6 2.5 2.5 0 0 0 4.5 12.5z" />
        </svg>
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[{ label: 'Disconnect Dropbox', danger: true, onClick: () => disconnect() }]}
        />
      )}
    </>
  )
}

export default SyncButton
