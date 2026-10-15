import { useEffect, useRef } from 'react'
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi'
import { getCurrentWindow, primaryMonitor } from '@tauri-apps/api/window'
import { useChime, useDueReminders } from './dueReminders'
import { ReminderCard } from './ReminderAlerts'
import { POPUP_WIDTH, popupPosition, sendFromPopup } from './popupWindow'

// The page inside the desktop reminder pop-up window (opened by popupWindow.ts with
// ?view=reminder-popup, see main.tsx). Shows the due reminders, chimes for new ones, sizes
// the window to fit them, and sends button clicks to the main window.
function ReminderPopup() {
  const due = useDueReminders()
  useChime(due)
  const listRef = useRef<HTMLDivElement>(null)

  // Fit the window to the cards (at most the screen's height) and keep it in the corner
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const fit = async () => {
      const monitor = await primaryMonitor()
      const maxHeight = monitor ? monitor.workArea.size.height / monitor.scaleFactor - 24 : 600
      const height = Math.min(Math.ceil(list.scrollHeight), maxHeight)
      if (height === 0) return
      const win = getCurrentWindow()
      await win.setSize(new LogicalSize(POPUP_WIDTH, height))
      const { x, y } = await popupPosition(height)
      await win.setPosition(new LogicalPosition(x, y))
    }
    const observer = new ResizeObserver(() => fit().catch((error) => console.error(error)))
    observer.observe(list)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={listRef} className="reminder-popup" role="alert">
      {due?.map((reminder) => (
        <ReminderCard
          key={reminder.id}
          reminder={reminder}
          withOpen
          onAction={(action) => sendFromPopup({ id: reminder.id, action })}
        />
      ))}
    </div>
  )
}

export default ReminderPopup
