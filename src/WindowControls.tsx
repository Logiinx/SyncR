import { useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { finalSync } from './autoSync'
import { loadBackground, startedHidden } from './desktop'

// Minimize / maximize / close, drawn by us because the Windows title bar is hidden.
// Icons: 10×10, same line weight, drawn fully inside the box so nothing gets clipped.
// Only in the desktop app; the browser/phone version shows nothing.
function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!isTauri()) return
    const win = getCurrentWindow()
    // The window starts hidden and was already moved to its saved place (lib.rs):
    // show it now that the app has drawn its first screen, so it appears in one go.
    // Started by Windows at sign-in ("Start with Windows") with "Start hidden in the tray"
    // on: stay hidden, only the tray icon shows.
    startedHidden().then((byWindows) => {
      if (!(byWindows && loadBackground().startHidden)) win.show().then(() => win.setFocus())
    })
    const refresh = () => win.isMaximized().then(setMaximized)
    refresh()
    const stopResize = win.onResized(refresh)
    // Every way of closing (✕, Alt+F4, taskbar):
    // - "✕ hides SyncR in the tray" on: hide instead; SyncR keeps running (sync, reminders).
    //   Quit is in the tray icon's menu.
    // - otherwise: last sync first (max 5 s). Tauri keeps the window open until this
    //   finishes, then closes it, and the app ends (lib.rs).
    const stopClose = win.onCloseRequested((event) => {
      if (loadBackground().closeToTray) {
        event.preventDefault()
        return win.hide()
      }
      return finalSync()
    })
    return () => {
      stopResize.then((unlisten) => unlisten())
      stopClose.then((unlisten) => unlisten())
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
            <rect x="0.625" y="2.625" width="6.75" height="6.75" rx="1" />
            <path d="M2.625 2.625V1.625a1 1 0 0 1 1-1h4.75a1 1 0 0 1 1 1v4.75a1 1 0 0 1-1 1H7.375" />
          </svg>
        ) : (
          <svg viewBox="0 0 10 10">
            <rect x="0.625" y="0.625" width="8.75" height="8.75" rx="1" />
          </svg>
        )}
      </button>
      <button className="close" onClick={() => win.close()} title="Close">
        <svg viewBox="0 0 10 10">
          <path d="M0.75 0.75l8.5 8.5M9.25 0.75l-8.5 8.5" />
        </svg>
      </button>
    </div>
  )
}

export default WindowControls
