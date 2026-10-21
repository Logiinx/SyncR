// The Reminders tab shows Google Calendar events (calendarEvents.ts); SyncR's own reminders were
// replaced by them (DECISIONS.md, "Reminders become Google Calendar events").

export const REMINDERS_TAB = 'reminders' // the Reminders tab's id among the open tabs (like GAMES_TAB)

// "Today, 18:00", "Tomorrow, 09:00", "Yesterday, 14:30", otherwise "3 November 2026, 14:00".
// allDay (an all-day event, a release day): no time, e.g. "Today", "3 November 2026".
export function formatDue(time: number, allDay = false) {
  const date = new Date(time)
  const pad = (n: number) => String(n).padStart(2, '0')
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const day = new Date(time).setHours(0, 0, 0, 0)
  const ref = new Date()
  ref.setHours(0, 0, 0, 0)
  const dayFromToday = (offset: number) => new Date(ref).setDate(ref.getDate() + offset)
  const at = allDay ? '' : `, ${clock}`
  if (day === dayFromToday(0)) return `Today${at}`
  if (day === dayFromToday(1)) return `Tomorrow${at}`
  if (day === dayFromToday(-1)) return `Yesterday${at}`
  return `${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}${at}`
}
