import { useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { getCurrentWindow, primaryMonitor } from '@tauri-apps/api/window'
import type { Reminder } from './db'
import { runAction, type ReminderAction } from './dueReminders'

// The desktop reminder pop-up: a small always-on-top window in the bottom-right corner of the
// screen, shown while reminders are due, even when SyncR's window is hidden in the tray.
// The main window opens and closes it; the pop-up (ReminderPopup.tsx) shows the reminders
// itself (same database) and sends its button clicks back here, so all changes and syncing
// happen in the main window.

export const POPUP_LABEL = 'reminder-popup'
export const POPUP_WIDTH = 390
const MARGIN = 12 // from the screen edges

// Button clicks from the pop-up to the main window: through Tauri's events in the desktop
// app; through a BroadcastChannel in the browser (only used to test the pop-up page in a tab)
export interface PopupMessage {
  id: string
  action: ReminderAction
}
const EVENT = 'reminder-popup-action'

export function sendFromPopup(message: PopupMessage) {
  if (isTauri()) emit(EVENT, message)
  else {
    const channel = new BroadcastChannel(EVENT)
    channel.postMessage(message)
    channel.close()
  }
}

function onPopupMessage(handle: (message: PopupMessage) => void): () => void {
  if (isTauri()) {
    const stop = listen<PopupMessage>(EVENT, (event) => handle(event.payload))
    return () => void stop.then((unlisten) => unlisten())
  }
  const channel = new BroadcastChannel(EVENT)
  channel.onmessage = (event: MessageEvent<PopupMessage>) => handle(event.data)
  return () => channel.close()
}

// Is this page the pop-up? By its window label in the desktop app (works whatever its
// address), or by ?view=reminder-popup (browser test)
export const isPopupPage = () =>
  new URLSearchParams(location.search).get('view') === POPUP_LABEL ||
  (isTauri() && getCurrentWindow().label === POPUP_LABEL)

// Top-left corner for a pop-up of this height: bottom-right of the main screen's work area
// (the screen without the taskbar). In logical pixels, like the window sizes.
export async function popupPosition(height: number) {
  const monitor = await primaryMonitor()
  if (!monitor) return { x: 100, y: 100 }
  const { position, size } = monitor.workArea
  const scale = monitor.scaleFactor
  return {
    x: (position.x + size.width) / scale - POPUP_WIDTH - MARGIN,
    y: (position.y + size.height) / scale - height - MARGIN,
  }
}

let opening = false

async function openPopup(onError: () => void) {
  if (opening || (await WebviewWindow.getByLabel(POPUP_LABEL))) return
  opening = true
  const height = 150 // first guess; the pop-up resizes itself to fit
  const { x, y } = await popupPosition(height)
  const popup = new WebviewWindow(POPUP_LABEL, {
    url: 'index.html?view=reminder-popup',
    title: 'SyncR reminder',
    x,
    y,
    width: POPUP_WIDTH,
    height,
    decorations: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    focus: false, // don't take the keyboard away from what the user is doing
    backgroundColor: '#202020',
    // Same origin as the main window (https://tauri.localhost, tauri.conf.json), so the pop-up
    // sees the same database. Without it, it loaded from http://… and found no reminders.
    useHttpsScheme: true,
  })
  popup.once('tauri://created', () => (opening = false))
  popup.once('tauri://error', (error) => {
    console.error('Reminder pop-up failed', error)
    opening = false
    onError()
  })
}

async function closePopup() {
  await (await WebviewWindow.getByLabel(POPUP_LABEL))?.destroy()
}

// "Open SyncR": the main window comes back from the tray / minimized / behind others
async function showMainWindow() {
  const win = getCurrentWindow()
  await win.unminimize()
  await win.show()
  await win.setFocus()
}

// Used by the main window: keeps the pop-up open while reminders are due and runs its button
// clicks. Returns true if the pop-up couldn't open (then the main window shows cards).
export function useReminderPopup(due: Reminder[] | undefined) {
  const [failed, setFailed] = useState(false)

  // Checked on every change (not just "some due / none due"), so a pop-up closed with
  // Alt+F4 comes back within a minute while reminders are still due
  useEffect(() => {
    if (!isTauri() || due === undefined || failed) return
    if (due.length > 0) openPopup(() => setFailed(true)).catch(() => setFailed(true))
    else closePopup()
  }, [due, failed])

  useEffect(() => {
    if (!isTauri()) return
    return onPopupMessage(({ id, action }) => {
      if (action === 'open') showMainWindow()
      else runAction(id, action)
    })
  }, [])

  return failed
}
