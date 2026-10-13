import { useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

// Minimize / maximize / close, drawn by us because the Windows title bar is hidden.
// Only in the desktop app; the browser/phone version shows nothing.
function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!isTauri()) return
    const win = getCurrentWindow()
    const refresh = () => win.isMaximized().then(setMaximized)
    refresh()
    const stop = win.onResized(refresh)
    return () => {
      stop.then((unlisten) => unlisten())
    }
  }, [])

  if (!isTauri()) return null
  const win = getCurrentWindow()

  return (
    <div className="window-controls">
      <button onClick={() => win.minimize()} title="Minimize">
        <svg viewBox="0 0 10 10">
          <path d="M0 5h10" />
        </svg>
      </button>
      <button onClick={() => win.toggleMaximize()} title={maximized ? 'Restore' : 'Maximize'}>
        {maximized ? (
          <svg viewBox="0 0 10 10">
            <path d="M2 2V0h8v8H8M0 2h8v8H0z" />
          </svg>
        ) : (
          <svg viewBox="0 0 10 10">
            <path d="M0 0h10v10H0z" />
          </svg>
        )}
      </button>
      {/* TODO (sync step): final sync before closing */}
      <button className="close" onClick={() => win.close()} title="Close">
        <svg viewBox="0 0 10 10">
          <path d="M0 0l10 10M10 0L0 10" />
        </svg>
      </button>
    </div>
  )
}

export default WindowControls
