// The Reminders tab shows Google Calendar events (calendarEvents.ts); SyncR's own reminders were
// replaced by them (DECISIONS.md, "Reminders become Google Calendar events").

import { clockTime, nearDay } from './dates'

export const REMINDERS_TAB = 'reminders' // the Reminders tab's id among the open tabs (like GAMES_TAB)

// "Today, 18:00", "Tomorrow, 09:00", "Yesterday, 14:30", otherwise "3 November 2026, 14:00".
// allDay (an all-day event, a release day): no time, e.g. "Today", "3 November 2026".
export function formatDue(time: number, allDay = false) {
  const at = allDay ? '' : `, ${clockTime(time)}`
  const day = nearDay(time) ?? new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  return `${day}${at}`
}
