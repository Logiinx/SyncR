// The app's day format, "21 Oct 2026", used wherever a plain date shows (notes, sync, games).
// Reminders spell the month out ("21 October 2026"): their dates are the main content there.
export function shortDate(time: number) {
  return new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
