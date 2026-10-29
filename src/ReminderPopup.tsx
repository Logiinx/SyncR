import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { LogicalSize } from '@tauri-apps/api/dpi'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { BACKGROUND_KEY, loadBackground } from './desktop'
import { useDueReminders, type DueItem } from './dueReminders'
import { useMailAlerts, type MailAction, type MailAlert } from './mailAlerts'
import MailReader from './MailReader'
import { loadMailBody, prefetchMails } from './mailPrefetch'
import { useGmailAccounts } from './gmail'
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
  useGmailAccounts() // redraws the cards when an account's color changes
  usePopupSounds(due, mails)
  const listRef = useRef<HTMLDivElement>(null)

  // Each new mail's text is downloaded as soon as its card shows (memory only, mailPrefetch.ts)
  useEffect(() => prefetchMails(mails), [mails])

  // An email open to read: first prepared unseen at the reader's size (its text, dark colors,
  // its width measured), the cards staying as they are (a spinner on the card if it takes a
  // moment). Then the window grows once, straight to its final size: READER_WIDTH or wider for
  // a wide email (up to 90% of the screen's width), 80% of the screen's height. Until Back,
  // Done or Mark as unread. Reminders that come due meanwhile show above it.
  const [openKey, setOpenKey] = useState<string | null>(null) // being prepared or read
  const [readerSize, setReaderSize] = useState<Size | null>(null) // set once ready: reading
  const open = mails.find((mail) => mail.key === openKey)
  const reading = readerSize ? open : undefined
  const preparing = !!open && !readerSize
  const readingRef = useRef(false)
  readingRef.current = reading !== undefined
  const readerSizeRef = useRef(readerSize)
  readerSizeRef.current = readerSize
  const cardsSize = useRef<Size | null>(null) // the window's size before the email opened
  const stageSize = useRef<Size>({ width: READER_WIDTH, height: 600 }) // where it's prepared
  const maxReaderWidth = useRef(READER_WIDTH)

  async function read(alert: MailAlert) {
    if (readerSizeRef.current) return
    const list = listRef.current
    if (isTauri()) {
      const win = getCurrentWindow()
      cardsSize.current = (await win.innerSize()).toLogical(await win.scaleFactor())
    } else if (list) {
      cardsSize.current = { width: list.offsetWidth, height: list.offsetHeight } // browser test
    }
    const { maxHeight, maxWidth } = isTauri()
      ? (await popupPlacer())(0)
      : { maxHeight: window.innerHeight, maxWidth: window.innerWidth }
    stageSize.current = { width: READER_WIDTH, height: Math.round(maxHeight * 0.8) }
    maxReaderWidth.current = Math.max(READER_WIDTH, Math.round(maxWidth * 0.9))
    setOpenKey(alert.key)
    if (!alert.opened) sendFromPopup({ id: alert.key, action: 'mail-opened' }) // marks it read
  }

  // The prepared email is ready, `extra` pixels wider than the reader: the window grows to show
  // it (fit below), wider by what's allowed. Returns the pixels given.
  function onReaderReady(extra: number) {
    const { width, height } = stageSize.current
    const wider = Math.min(width + Math.ceil(extra), maxReaderWidth.current)
    setReaderSize({ width: wider, height })
    return wider - width
  }

  // A spinner on the card, only if preparing takes a moment (not downloaded yet)
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    setSlow(false)
    if (!preparing) return
    const timer = window.setTimeout(() => setSlow(true), 150)
    return () => window.clearTimeout(timer)
  }, [preparing, openKey])

  // Back, Done, Mark as unread: the reader shrinks back to the cards' size in its corner, the
  // window gets small again, then the cards come back (and `then`, e.g. the button's action)
  async function closeReader(then?: () => void) {
    const list = listRef.current
    const from = readerSizeRef.current
    if (list && from && cardsSize.current && loadAppearance().animations) {
      await list.animate([{ clipPath: FULL_CLIP }, { clipPath: cornerClip(cardsSize.current, from) }], {
        duration: GROW_MS,
        easing: 'cubic-bezier(0.3, 0, 0.8, 0.15)',
        fill: 'forwards',
      }).finished
      await placeWindow(cardsSize.current) // so the cards don't show in a corner of the big window
    }
    setOpenKey(null)
    setReaderSize(null)
    then?.()
  }

  // Fit the window to the cards (at most the screen's height) and keep it in its corner. Also
  // when the screen or corner is changed in Settings (main window, same storage), and when an
  // email opens or closes. One fit at a time (they're asynchronous).
  const refitRef = useRef(() => {})
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    let queue = Promise.resolve()
    const fit = async () => {
      const place = await popupPlacer()
      const reader = readingRef.current ? readerSizeRef.current : null
      const height = reader?.height ?? Math.min(Math.ceil(list.getBoundingClientRect().height), place(0).maxHeight)
      if (height === 0) return
      await placeWindow({ width: reader?.width ?? POPUP_WIDTH, height }, place)
      // Opening an email: it was drawn cut to the cards' size (below); now that the window is
      // big (see-through around it), it opens up smoothly from its corner
      const from = list.dataset.growFrom
      if (reader && from) {
        delete list.dataset.growFrom
        list.style.clipPath = ''
        list.animate([{ clipPath: from }, { clipPath: FULL_CLIP }], { duration: GROW_MS, easing: 'cubic-bezier(0.2, 0, 0, 1)' })
      }
    }
    const refit = () => {
      queue = queue.then(fit).catch((error) => console.error(error))
    }
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
  // The first frame of an open email: cut to the cards' size, so nothing jumps before the
  // window has grown (fit above). Closed: no cut left.
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    if (reading && readerSize && cardsSize.current && loadAppearance().animations) {
      list.dataset.growFrom = cornerClip(cardsSize.current, readerSize)
      list.style.clipPath = list.dataset.growFrom
    } else if (!reading) {
      list.getAnimations().forEach((animation) => animation.cancel())
      delete list.dataset.growFrom
      list.style.clipPath = ''
    }
  }, [reading !== undefined]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    refitRef.current()
  }, [reading !== undefined])
  const fading = useMailFade(mails, !!open)
  const mailAction = (alert: MailAlert, action: MailAction) => sendFromPopup({ id: alert.key, action })
  return (
    <div
      ref={listRef}
      className={`reminder-popup${reading ? ' reading' : ''}`}
      style={reading && readerSize ? readerStyle(readerSize) : undefined}
      role="alert"
    >
      {due && <ReminderCards due={due} onAction={(item, action) => sendFromPopup({ id: item.key, action })} />}
      {!reading && (
        <MailCards
          alerts={mails}
          fading={fading}
          loadingKey={preparing && slow ? openKey : null}
          onAction={mailAction}
          onRead={read}
        />
      )}
      {/* The same reader while prepared (unseen, at its size) and read: kept in one place, so
          the mail isn't loaded again when it shows */}
      {open && (
        <div style={reading ? { display: 'contents' } : stageStyle(stageSize.current)}>
          <MailReader
            fitWidth
            loadBody={loadMailBody}
            onReady={onReaderReady}
            alert={open}
            onAction={(action) =>
              action === 'mail-open' ? mailAction(open, action) : closeReader(() => mailAction(open, action))
            }
            onBack={() => closeReader()}
          />
        </div>
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

// Emails fade by themselves after the delay chosen in Settings → Alerts → Emails (never by default),
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

// Opening and closing an email: the window is see-through (popupWindow.ts), so it changes size
// at once and only what's drawn moves: a cut (clip-path) that grows from the cards' size in the
// pop-up's corner to the whole reader, or back. Smooth, unlike resizing the window in steps.
type Size = { width: number; height: number }
const GROW_MS = 200
const RADIUS = 8 // px, the pop-up's corners (index.css, .reminder-popup)
const FULL_CLIP = `inset(0px 0px 0px 0px round ${RADIUS}px)`

// The part of the big size that the small one covers, in the pop-up's corner
function cornerClip(small: Size, big: Size) {
  const { popupCorner } = loadBackground()
  const dx = Math.max(0, big.width - small.width)
  const dy = Math.max(0, big.height - small.height)
  const top = popupCorner.startsWith('top') ? 0 : dy
  const left = popupCorner.endsWith('left') ? 0 : dx
  return `inset(${top}px ${dx - left}px ${dy - top}px ${left}px round ${RADIUS}px)`
}

// The reader's box: its full size, held in the pop-up's corner (also while the window is
// still small)
function readerStyle({ width, height }: Size): CSSProperties {
  const { popupCorner } = loadBackground()
  return {
    position: 'fixed',
    width,
    height,
    [popupCorner.startsWith('top') ? 'top' : 'bottom']: 0,
    [popupCorner.endsWith('left') ? 'left' : 'right']: 0,
  }
}

// Where an email is prepared: the reader's size and layout (like .reminder-popup.reading, with
// its border), out of the way and invisible
function stageStyle({ width, height }: Size): CSSProperties {
  return {
    position: 'fixed',
    top: 0,
    left: 0,
    width,
    height,
    display: 'flex',
    flexDirection: 'column',
    boxSizing: 'border-box',
    border: '1px solid transparent',
    visibility: 'hidden',
    pointerEvents: 'none',
  }
}

// Size first (in the scale of the screen it's on now), then the place for that height. Moving
// to a screen with another scale makes Windows rescale it to the same logical size.
async function placeWindow({ width, height }: Size, place?: Awaited<ReturnType<typeof popupPlacer>>) {
  const win = getCurrentWindow()
  await win.setSize(new LogicalSize(width, height))
  await win.setPosition((place ?? (await popupPlacer()))(height, width).position)
}

export default ReminderPopup
