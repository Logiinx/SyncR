import { useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { PhysicalPosition } from '@tauri-apps/api/dpi'
import { availableMonitors, getCurrentWindow, primaryMonitor, type Monitor } from '@tauri-apps/api/window'
import { loadBackground } from './desktop'
import { openAlertEvent, runAction, type DueItem, type ReminderAction } from './dueReminders'
import { runMailAction, type MailAction, type MailAlert } from './mailAlerts'

// The desktop reminder pop-up: a small always-on-top window in a corner of the screen (both
// chosen in Settings), shown while reminders are due or new emails came (mailAlerts.ts), even
// when SyncR's window is hidden in the tray.
// The main window opens and closes it; the pop-up (ReminderPopup.tsx) shows the reminders
// itself (same database) and sends its button clicks back here, so all changes and syncing
// happen in the main window.

export const POPUP_LABEL = 'reminder-popup'
export const POPUP_WIDTH = 390
export const READER_WIDTH = 600 // while an email is open to read (MailReader.tsx)
const MARGIN = 12 // from the screen edges

// Button clicks from the pop-up to the main window: through Tauri's events in the desktop
// app; through a BroadcastChannel in the browser (only used to test the pop-up page in a tab)
export interface PopupMessage {
  id: string // an event alert's key (DueItem.key) or an email's (MailAlert.key, "mail:…")
  action: ReminderAction | MailAction
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

// The screen the pop-up shows on (Settings): the chosen one while it's plugged in, else the
// main one
export async function popupMonitor(): Promise<Monitor | null> {
  const { popupScreen } = loadBackground()
  const monitors = popupScreen ? await availableMonitors() : []
  return monitors.find((monitor) => monitor.name === popupScreen) ?? (await primaryMonitor())
}

// Where a pop-up of this height and width (logical pixels) goes: the chosen corner of its screen's work
// area (the screen without the taskbar). In physical pixels with that screen's scale, so it
// also lands right on a second screen with another scale than the main one.
// maxHeight: the most it may grow (logical pixels), the work area's height.
export async function popupPlace(height: number, width = POPUP_WIDTH) {
  return (await popupPlacer())(height, width)
}

// The same, with the screen and corner looked up once: for the many steps of an animation
export async function popupPlacer() {
  const monitor = await popupMonitor()
  const { popupCorner } = loadBackground()
  return (height: number, width = POPUP_WIDTH) => {
    if (!monitor) return { position: new PhysicalPosition(100, 100), scale: 1, maxHeight: 600 }
    const { position, size } = monitor.workArea
    const scale = monitor.scaleFactor
    const margin = MARGIN * scale
    const x = popupCorner.endsWith('left') ? position.x + margin : position.x + size.width - width * scale - margin
    const y = popupCorner.startsWith('top') ? position.y + margin : position.y + size.height - height * scale - margin
    return {
      position: new PhysicalPosition(Math.round(x), Math.round(y)),
      scale,
      maxHeight: size.height / scale - 2 * MARGIN,
    }
  }
}

let opening = false
let wanted = false // something to show: false once all is done (a pop-up still opening then closes)

async function openPopup(onError: () => void) {
  // Marked at once: two changes in a row (e.g. reminders and emails loading at start) must not
  // both open one, the second would fail and the main window would stop closing the pop-up
  if (opening) return
  opening = true
  let created = false
  try {
    if (await WebviewWindow.getByLabel(POPUP_LABEL)) return
    await createPopup(onError)
    created = true // "opening" ends when Tauri says it's there (createPopup)
  } finally {
    if (!created) opening = false
  }
}

async function createPopup(onError: () => void) {
  const height = 150 // first guess; the pop-up resizes itself to fit
  const { position, scale } = await popupPlace(height)
  const popup = new WebviewWindow(POPUP_LABEL, {
    url: 'index.html?view=reminder-popup',
    title: 'SyncR reminder',
    x: position.x / scale, // the window options take logical pixels
    y: position.y / scale,
    width: POPUP_WIDTH,
    height,
    decorations: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    // Never takes the keyboard away from what the user is doing (e.g. a fullscreen game: no
    // jump out of it). Nothing else may focus it either: only a click on a card brings SyncR.
    focus: false,
    backgroundColor: '#202020',
    // Same origin as the main window (https://tauri.localhost, tauri.conf.json), so the pop-up
    // sees the same database. Without it, it loaded from http://… and found no reminders.
    useHttpsScheme: true,
  })
  popup.once('tauri://created', () => {
    opening = false
    if (!wanted) closePopup() // everything was done while it opened
  })
  popup.once('tauri://error', (error) => {
    console.error('Reminder pop-up failed', error)
    opening = false
    onError()
  })
}

async function closePopup() {
  await (await WebviewWindow.getByLabel(POPUP_LABEL))?.destroy()
}

// A click on a card: the main window comes back from the tray / minimized / behind others
async function showMainWindow() {
  const win = getCurrentWindow()
  await win.unminimize()
  await win.show()
  await win.setFocus()
}

// Used by the main window: keeps the pop-up open while reminders are due or emails are new,
// and runs its button clicks. Returns true if the pop-up couldn't open (then the main window
// shows the reminders' cards; emails then wait for the pop-up, PC only anyway).
export function useReminderPopup(due: DueItem[] | undefined, mails: MailAlert[]) {
  const [failed, setFailed] = useState(false)

  // Checked on every change (not just "some due / none due"), so a pop-up closed with
  // Alt+F4 comes back within a minute while reminders are still due
  useEffect(() => {
    if (!isTauri() || due === undefined || failed) return
    wanted = due.length > 0 || mails.length > 0
    if (wanted) openPopup(() => setFailed(true)).catch(() => setFailed(true))
    else closePopup()
  }, [due, mails, failed])

  useEffect(() => {
    if (!isTauri()) return
    return onPopupMessage(({ id, action }) => {
      if (action.startsWith('mail-')) {
        runMailAction(id, action as MailAction).catch((error) => console.error(error))
      }
      else if (action === 'open') {
        showMainWindow()
        openAlertEvent(id)
      }
      else runAction(id, action as Exclude<ReminderAction, 'open'>)
    })
  }, [])

  return failed
}
