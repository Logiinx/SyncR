import { capitalize, currentLanguage, locale, plural, t } from './i18n'

// A day in the app's language. French says "1er novembre", which the browser doesn't write.
function dayText(time: number, month: 'short' | 'long', weekday?: 'long') {
  const text = new Date(time).toLocaleDateString(locale(), { weekday, day: 'numeric', month, year: 'numeric' })
  return currentLanguage() === 'fr' ? text.replace(/(^|\s)1 /, '$11er ') : text
}

// The app's day format, "21 Oct 2026", used wherever a plain date shows (notes, sync, games).
export const shortDate = (time: number) => dayText(time, 'short')

// "17 Dec": a day near enough that its year goes without saying (the next Steam sale)
export function dayMonth(time: number) {
  const text = new Date(time).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })
  return currentLanguage() === 'fr' ? text.replace(/(^|\s)1 /, '$11er ') : text
}

// Reminders spell the month out ("21 October 2026"): their dates are the main content there.
export const longDate = (time: number) => dayText(time, 'long')

// "Tuesday 27 October 2026"
export const fullDate = (time: number) => capitalize(dayText(time, 'long', 'long'))

// "14:32" (24 h): the time in every date that has one
export function clockTime(time: number) {
  return new Date(time).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) // i18n-ok
}

// "Last watched today", "... yesterday", "... 3 days ago", "... 2 weeks ago", "... 5 months ago",
// "... 2 years ago": how long ago something last happened, in calendar days
export function lastWatchedText(time: number) {
  const day = new Date(time).setHours(0, 0, 0, 0)
  const today = new Date().setHours(0, 0, 0, 0)
  const days = Math.max(0, Math.round((today - day) / 86_400_000))
  if (days === 0) return t('Last watched today')
  if (days === 1) return t('Last watched yesterday')
  if (days < 14) return plural(days, 'Last watched {n} day ago', 'Last watched {n} days ago')
  if (days < 60) return plural(Math.floor(days / 7), 'Last watched {n} week ago', 'Last watched {n} weeks ago')
  if (days < 730) return plural(Math.floor(days / 30.4), 'Last watched {n} month ago', 'Last watched {n} months ago')
  return plural(Math.floor(days / 365), 'Last watched {n} year ago', 'Last watched {n} years ago')
}

// How old something is, starting a line: "Just now", "25 min ago", "3 h ago", then in calendar
// days "Yesterday", "3 days ago", "2 weeks ago", "5 months ago", "2 years ago". Null when it's
// still to come (a scheduled video).
export function ageText(time: number) {
  const minutes = Math.floor((Date.now() - time) / 60_000)
  if (minutes < 0) return null
  if (minutes < 1) return capitalize(t('just now'))
  if (minutes < 60) return capitalize(t('{n} min ago', { n: minutes }))
  if (minutes < 24 * 60) return capitalize(t('{n} h ago', { n: Math.floor(minutes / 60) }))
  const days = Math.max(1, Math.round((new Date().setHours(0, 0, 0, 0) - new Date(time).setHours(0, 0, 0, 0)) / 86_400_000))
  if (days === 1) return t('Yesterday')
  if (days < 14) return plural(days, '{n} day ago', '{n} days ago')
  if (days < 60) return plural(Math.floor(days / 7), '{n} week ago', '{n} weeks ago')
  if (days < 730) return plural(Math.floor(days / 30.4), '{n} month ago', '{n} months ago')
  return plural(Math.floor(days / 365), '{n} year ago', '{n} years ago')
}

// How long until a day: "today", "tomorrow", "in 34 days", "in 5 months" (a release, a sale).
// Null once it's past. Counts calendar days, not 24h blocks.
export function untilText(time: number) {
  const days = Math.round((new Date(time).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000)
  if (days < 0) return null
  if (days === 0) return t('today')
  if (days === 1) return t('tomorrow')
  if (days < 60) return t('in {n} days', { n: days })
  return t('in {n} months', { n: Math.round(days / 30.4) })
}

// "Today", "Tomorrow" or "Yesterday", else null. Counts calendar days (setDate, not "minus 24
// hours": days with a clock change are 23 or 25 hours long).
export function nearDay(time: number): string | null {
  const day = new Date(time).setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const fromToday = (offset: number) => new Date(today).setDate(today.getDate() + offset)
  if (day === fromToday(0)) return t('Today')
  if (day === fromToday(1)) return t('Tomorrow')
  if (day === fromToday(-1)) return t('Yesterday')
  return null
}
