import { useEffect, useRef, useState } from 'react'
import { LogicalSize } from '@tauri-apps/api/dpi'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { BACKGROUND_KEY, loadBackground } from './desktop'
import { useDueReminders, type DueItem } from './dueReminders'
import { useMailAlerts, type MailAction, type MailAlert } from './mailAlerts'
import MailReader from './MailReader'
import { MailCards } from './MailCards'
import { playEmailSound, playReminderSound } from './sounds'
import { ReminderCards } from './ReminderAlerts'
import { loadAppearance } from './appearance'
import { POPUP_WIDTH, popupPlacer, READER_WIDTH, sendFromPopup } from './popupWindow'

// The page inside the desktop reminder pop-up window (opened by popupWindow.ts with
// ?view=reminder-popup, see main.tsx). Shows the due reminders and new emails, plays a sound
// for new ones, sizes the window to fit them, and sends button clicks to the main window.
function ReminderPopup() {
  const due = useDueReminders()
  const mails = useMailAlerts()
  usePopupSounds(due, mails)
  const listRef = useRef<HTMLDivElement>(null)

  // An email open to read: the window grows (READER_WIDTH, 80% of the screen's height) until
  // Back, Done or Mark as unread. Reminders that come due meanwhile show above it.
  const [readingKey, setReadingKey] = useState<string | null>(null)
  const reading = mails.find((mail) => mail.key === readingKey)
  const readingRef = useRef(false)
  readingRef.current = reading !== undefined

  function read(alert: MailAlert) {
    setReadingKey(alert.key)
    if (!alert.opened) sendFromPopup({ id: alert.key, action: 'mail-opened' }) // marks it read
  }

  // Fit the window to the cards (at most the screen's height) and keep it in its corner. Also
  // when the screen or corner is changed in Settings (main window, same storage), and when an
  // email opens or closes: then it grows or shrinks smoothly from its corner (unless
  // Animations are off). Fits asked for during that animation wait for its end.
  const refitRef = useRef(() => {})
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    let wasReading = false
    let animating = false
    let again = false
    const fit = async () => {
      if (animating) return void (again = true)
      const place = await popupPlacer()
      const { maxHeight } = place(0)
      const reading = readingRef.current
      const width = reading ? READER_WIDTH : POPUP_WIDTH
      const height = reading ? Math.round(maxHeight * 0.8) : Math.min(Math.ceil(list.scrollHeight), maxHeight)
      if (height === 0) return
      const win = getCurrentWindow()
      if (reading !== wasReading && loadAppearance().animations) {
        wasReading = reading
        animating = true
        try {
          await resizeSmoothly(place, width, height)
        } finally {
          animating = false
        }
        if (again) {
          again = false
          await fit()
        }
        return
      }
      wasReading = reading
      // Size first (in the scale of the screen it's on now), then the place for that height.
      // Moving to a screen with another scale makes Windows rescale it to the same logical size.
      await win.setSize(new LogicalSize(width, height))
      await win.setPosition(place(height, width).position)
    }
    const refit = () => void fit().catch((error) => console.error(error))
    refitRef.current = refit
    const observer = new ResizeObserver(refit)
    observer.observe(list)
    const onStorage = (e: StorageEvent) => e.key === BACKGROUND_KEY && refit()
    window.addEventListener('storage', onStorage)
    return () => {
      observer.disconnect()
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  useEffect(() => {
    refitRef.current()
  }, [reading !== undefined])

  const fading = useMailFade(mails, reading !== undefined)
  const mailAction = (alert: MailAlert, action: MailAction) => sendFromPopup({ id: alert.key, action })
  return (
    <div ref={listRef} className={`reminder-popup${reading ? ' reading' : ''}`} role="alert">
      {due && <ReminderCards due={due} onAction={(item, action) => sendFromPopup({ id: item.key, action })} />}
      {reading ? (
        <MailReader
          alert={reading}
          onAction={(action) => mailAction(reading, action)}
          onBack={() => setReadingKey(null)}
        />
      ) : (
        <MailCards alerts={mails} fading={fading} onAction={mailAction} onRead={read} />
      )}
    </div>
  )
}

// One sound for what's new since the last change: the reminder sound if a reminder is among
// it (also when an email came at the same time), else the email sound
function usePopupSounds(due: DueItem[] | undefined, mails: MailAlert[]) {
  const heard = useRef(new Set<string>())
  useEffect(() => {
    if (!due) return
    const reminders = due.map((item) => `${item.key}@${item.dueAt}`)
    const keys = [...reminders, ...mails.map((mail) => mail.key)]
    if (reminders.some((key) => !heard.current.has(key))) playReminderSound()
    else if (keys.some((key) => !heard.current.has(key))) playEmailSound()
    heard.current = new Set(keys)
  }, [due, mails])
}

// Emails fade by themselves after the delay chosen in Settings → Gmail (never by default),
// counted from when each card appeared. Not while the mouse is over the pop-up or a mail is
// open to read: then every card starts its delay again afterwards. Opened (read) cards don't
// fade. A faded card goes as "missed" (mailAlerts.ts); its mail stays unread.
const FADE_OUT_MS = 400 // the fade itself (index.css, .reminder-alert.fading)

function useMailFade(mails: MailAlert[], reading: boolean) {
  const [hovered, setHovered] = useState(false)
  const [fading, setFading] = useState<Set<string>>(new Set())
  const since = useRef(new Map<string, number>()) // when each card appeared (or the pause ended)

  useEffect(() => {
    const root = document.documentElement
    const enter = () => setHovered(true)
    const leave = () => setHovered(false)
    root.addEventListener('mouseenter', enter)
    root.addEventListener('mouseleave', leave)
    return () => {
      root.removeEventListener('mouseenter', enter)
      root.removeEventListener('mouseleave', leave)
    }
  }, [])

  const paused = hovered || reading
  useEffect(() => {
    const seconds = loadBackground().emailFade
    const now = Date.now()
    for (const key of since.current.keys()) {
      if (!mails.some((mail) => mail.key === key)) since.current.delete(key) // gone
    }
    if (paused || !seconds) {
      since.current.clear() // the delay starts again once the pause ends
      setFading(new Set())
      return
    }
    // Also the timers that end a fade: a mouse arriving during it brings the card back
    const timers: ReturnType<typeof setTimeout>[] = []
    for (const mail of mails.filter((m) => !m.opened)) {
      if (!since.current.has(mail.key)) since.current.set(mail.key, now)
      const left = since.current.get(mail.key)! + seconds * 1000 - now
      timers.push(setTimeout(() => {
        setFading((keys) => new Set(keys).add(mail.key))
        const out = loadAppearance().animations ? FADE_OUT_MS : 0
        timers.push(setTimeout(() => sendFromPopup({ id: mail.key, action: 'mail-fade' }), out))
      }, Math.max(left, 0)))
    }
    return () => timers.forEach(clearTimeout)
  }, [mails, paused])

  return fading
}

// Grows or shrinks the window to this size in steps (about 0.2 s, slowing down at the end),
// keeping it in its corner: from a bottom corner it grows upward. Each step moves and sizes
// it together (Tauri has no single call for both).
const STEPS = 12

async function resizeSmoothly(place: Awaited<ReturnType<typeof popupPlacer>>, width: number, height: number) {
  const win = getCurrentWindow()
  const start = (await win.innerSize()).toLogical(await win.scaleFactor())
  for (let i = 1; i <= STEPS; i++) {
    const t = 1 - (1 - i / STEPS) ** 2 // ease out
    const w = Math.round(start.width + (width - start.width) * t)
    const h = Math.round(start.height + (height - start.height) * t)
    await Promise.all([win.setPosition(place(h, w).position), win.setSize(new LogicalSize(w, h))])
    await new Promise((resolve) => setTimeout(resolve, 16))
  }
}

export default ReminderPopup
