// The app's day format, "21 Oct 2026", used wherever a plain date shows (notes, sync, games).
// Reminders spell the month out ("21 October 2026"): their dates are the main content there.
export function shortDate(time: number) {
  return new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// "14:32" (24 h): the time in every date that has one
export function clockTime(time: number) {
  return new Date(time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

// "Today", "Tomorrow" or "Yesterday", else null. Counts calendar days (setDate, not "minus 24
// hours": days with a clock change are 23 or 25 hours long).
export function nearDay(time: number): string | null {
  const day = new Date(time).setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const fromToday = (offset: number) => new Date(today).setDate(today.getDate() + offset)
  if (day === fromToday(0)) return 'Today'
  if (day === fromToday(1)) return 'Tomorrow'
  if (day === fromToday(-1)) return 'Yesterday'
  return null
}
