import { useEffect, useRef } from 'react'
import { LogicalSize } from '@tauri-apps/api/dpi'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { BACKGROUND_KEY } from './desktop'
import { useChime, useDueReminders } from './dueReminders'
import { ReminderCards } from './ReminderAlerts'
import { POPUP_WIDTH, popupPlace, sendFromPopup } from './popupWindow'

// The page inside the desktop reminder pop-up window (opened by popupWindow.ts with
// ?view=reminder-popup, see main.tsx). Shows the due reminders, chimes for new ones, sizes
// the window to fit them, and sends button clicks to the main window.
function ReminderPopup() {
  const due = useDueReminders()
  useChime(due)
  const listRef = useRef<HTMLDivElement>(null)

  // Fit the window to the cards (at most the screen's height) and keep it in its corner. Also
  // when the screen or corner is changed in Settings (main window, same storage).
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const fit = async () => {
      const { maxHeight } = await popupPlace(0)
      const height = Math.min(Math.ceil(list.scrollHeight), maxHeight)
      if (height === 0) return
      const win = getCurrentWindow()
      // Size first (in the scale of the screen it's on now), then the place for that height.
      // Moving to a screen with another scale makes Windows rescale it to the same logical size.
      await win.setSize(new LogicalSize(POPUP_WIDTH, height))
      await win.setPosition((await popupPlace(height)).position)
    }
    const refit = () => fit().catch((error) => console.error(error))
    const observer = new ResizeObserver(refit)
    observer.observe(list)
    const onStorage = (e: StorageEvent) => e.key === BACKGROUND_KEY && refit()
    window.addEventListener('storage', onStorage)
    return () => {
      observer.disconnect()
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  return (
    <div ref={listRef} className="reminder-popup" role="alert">
      {due && <ReminderCards due={due} onAction={(item, action) => sendFromPopup({ id: item.key, action })} />}
    </div>
  )
}

export default ReminderPopup
