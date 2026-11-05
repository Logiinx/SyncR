import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { syncAndWait } from './autoSync'
import { refreshEvents } from './calendarEvents'
import { db } from './db'
import { playReminderSound } from './sounds'
import { eventId, listEventAlerts, markAlertDone, markedElsewhere, MISSED_MS, snoozeAlert } from './eventAlerts'
import { REMINDERS_TAB } from './reminders'
import { ignoreAlertKey, priceEventGame } from './priceWatch'

// What is due right now, used by the cards (ReminderAlerts.tsx) and the desktop pop-up
// (ReminderPopup.tsx): the alerts of Google Calendar events (eventAlerts.ts).

const MINUTE_MS = 60 * 1000

// One card: an event alert
export interface DueItem {
  key: string // the event alert's key ("event:…")
  text: string
  note: string
  time: number // shown on the card: the event's start
  allDay: boolean
  dueAt: number // when it came due (a snoozed one: when the snooze ended)
  notMoved: boolean // snoozed in SyncR only: the event couldn't be moved in Google
  colorId?: string // the event's Google color (the card's strip)
  keyAlert: boolean // a price alert for a key: also "Wrong key" (priceWatch.ts ignoreAlertKey)
  elsewhere?: { done: boolean; text: string } // handled on the other device while its card showed: says so instead of buttons
}

// The buttons on a due item ('open': a click on the card's text)
export type ReminderAction = 'done' | 'snooze10' | 'snooze60' | 'tomorrow' | 'open' | 'wrongkey'

// A click on a card: SyncR shows the Reminders tab with the event's preview. RemindersView takes
// the event (takeAlertEvent) when it opens, or right away if it's already open.
let alertEvent: string | null = null
export function openAlertEvent(key: string) {
  alertEvent = eventId(key)
  window.dispatchEvent(new CustomEvent('open-note', { detail: { id: REMINDERS_TAB } }))
  window.dispatchEvent(new Event('open-alert-event'))
}
export function takeAlertEvent() {
  const id = alertEvent
  alertEvent = null
  return id
}

export function runAction(key: string, action: Exclude<ReminderAction, 'open'>) {
  if (action === 'done') return markAlertDone(key)
  // Done, and the watch goes on without that key price
  if (action === 'wrongkey') return ignoreAlertKey(eventId(key)).then(() => markAlertDone(key))
  if (action === 'snooze10') return snoozeAlert(key, 10)
  if (action === 'snooze60') return snoozeAlert(key, 60)
  return snoozeAlert(key, 'tomorrow')
}

// ---------- Up to date before a card shows ----------

const CHECK_MAX_MS = 5000 // no internet or a slow one must not hold back a reminder for long
const CHECK_SETTLE_MS = 150 // what the check stored reaches the list of alerts a moment later
const ELSEWHERE_MS = 5000 // how long a card handled on the other device stays
const CHECKED_KEY = 'syncr.alerts.checkedAt'

const readChecked = () => Number(localStorage.getItem(CHECKED_KEY)) || 0

// Before a card shows: the calendar and sync, in case the other device has already snoozed or
// done it. Only alerts due before the last check show, so an alert that comes due starts a new
// one. One at a time. Run by the main window; the pop-up window learns through localStorage.
let checking = false
async function runCheck(onDone: (startedAt: number) => void) {
  if (checking) return
  checking = true
  const startedAt = Date.now()
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  await Promise.race([Promise.allSettled([refreshEvents(), syncAndWait()]), wait(CHECK_MAX_MS)])
  await wait(CHECK_SETTLE_MS)
  localStorage.setItem(CHECKED_KEY, String(startedAt))
  checking = false
  onDone(startedAt)
}

// Event alerts as cards, soonest first, and the marks (to see who handled an alert)
async function listItems() {
  const [alerts, marks] = await Promise.all([listEventAlerts(), db.alertMarks.toArray()])
  const items: DueItem[] = alerts
    .map((a) => ({
      key: a.key, text: a.title, note: a.description, time: a.start, allDay: a.allDay, dueAt: a.dueAt, notMoved: a.notMoved, colorId: a.colorId,
      keyAlert: !!priceEventGame(eventId(a.key)) && a.title.endsWith(' for a key'), // priceWatch.ts alertText
    }))
    .sort((a, b) => a.dueAt - b.dueAt)
  return { items, marks: new Map(marks.map((mark) => [mark.key, mark])) }
}

// Everything due and not done, kept up to date. No "already shown" bookkeeping: an alert stays
// due until Done or Snooze, and alerts missed while the app was closed are simply
// due at the start, but only for a day (MISSED_MS), so a device that was off for a while
// doesn't bring back every old alert.
// A card on screen that the other device handles stays a few seconds, saying so (elsewhere). If the
// calendar brings the moved event before sync brings the mark, it just goes.
// undefined = still loading. runsCheck: the main window, which keeps the alerts up to date.
export function useDueReminders({ runsCheck = false } = {}): DueItem[] | undefined {
  const list = useLiveQuery(listItems, [])
  const items = list?.items
  const marks = list?.marks
  const [now, setNow] = useState(Date.now())
  // The app just started: nothing is checked yet
  const [checkedAt, setCheckedAt] = useState(() => {
    if (runsCheck) localStorage.removeItem(CHECKED_KEY)
    return readChecked()
  })
  const [leaving, setLeaving] = useState<DueItem[]>([])
  const shown = useRef<DueItem[]>([])

  // Wake up exactly when the next one is due (and at least every minute, in case the
  // clock or the sleep of the computer shifts things), and when the app comes back into view
  const nextDue = items?.find((item) => item.dueAt > now)?.dueAt
  useEffect(() => {
    const wait = nextDue ? Math.min(nextDue - Date.now(), MINUTE_MS) : MINUTE_MS
    const timer = setTimeout(() => setNow(Date.now()), Math.max(wait, 0) + 50)
    const onVisible = () => document.visibilityState === 'visible' && setNow(Date.now())
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [nextDue, now])

  const ready = items?.filter((item) => item.dueAt <= now && item.dueAt > now - MISSED_MS)
  const due = ready?.filter((item) => item.dueAt <= checkedAt)

  const needsCheck = !!ready?.some((item) => item.dueAt > checkedAt)
  useEffect(() => {
    if (runsCheck && needsCheck) void runCheck(setCheckedAt)
  }, [runsCheck, needsCheck, checkedAt])

  // The pop-up window: the main window's check
  useEffect(() => {
    if (runsCheck) return
    const onStorage = (e: StorageEvent) => e.key === CHECKED_KEY && setCheckedAt(readChecked())
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [runsCheck])

  // Cards that just went: the other device's doing?
  useEffect(() => {
    if (!due || !marks) return
    const gone = shown.current.filter((item) => !due.some((other) => other.key === item.key))
    shown.current = due
    const told: DueItem[] = gone.flatMap((item) => {
      const elsewhere = markedElsewhere(marks.get(item.key))
      return elsewhere ? [{ ...item, elsewhere }] : []
    })
    if (!told.length) return
    setLeaving((cards) => [...cards, ...told])
    setTimeout(() => setLeaving((cards) => cards.filter((card) => !told.includes(card))), ELSEWHERE_MS)
  }, [due, marks])

  return due && [...due, ...leaving].sort((a, b) => a.dueAt - b.dueAt)
}

// Chimes once for each item that newly comes due (a snoozed one counts as new again)
export function useChime(due: DueItem[] | undefined) {
  const chimed = useRef(new Set<string>())
  useEffect(() => {
    if (!due) return
    const keys = due.map((item) => `${item.key}@${item.dueAt}`)
    if (keys.some((key) => !chimed.current.has(key))) playReminderSound()
    chimed.current = new Set(keys)
  }, [due])
}
