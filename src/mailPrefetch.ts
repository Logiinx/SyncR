import { fetchMailBody, type MailAlert, type MailBody } from './mailAlerts'

// The desktop pop-up downloads each new mail's text as soon as its card shows, so opening it is
// instant and the pop-up can grow straight to the mail's width (ReminderPopup.tsx). In memory
// only (never on disk), dropped as soon as its card goes; at most MAX at a time. Fetching a mail
// doesn't mark it read, and its web images stay blocked until "Show images".
const MAX = 20
const bodies = new Map<string, Promise<MailBody>>()

// Keeps the texts of these cards (the first MAX), drops all others, downloads the missing ones
export function prefetchMails(alerts: MailAlert[]) {
  const wanted = alerts.slice(0, MAX)
  const keys = new Set(wanted.map((alert) => alert.key))
  for (const key of bodies.keys()) if (!keys.has(key)) bodies.delete(key)
  for (const alert of wanted) loadMailBody(alert).catch(() => {}) // a failed one is tried again on opening
}

// The mail's text: the one already downloaded, else downloads it now
export function loadMailBody(alert: MailAlert): Promise<MailBody> {
  let body = bodies.get(alert.key)
  if (!body) {
    const loading = fetchMailBody(alert)
    bodies.set(alert.key, loading)
    loading.catch(() => bodies.get(alert.key) === loading && bodies.delete(alert.key))
    body = loading
  }
  return body
}

// How many texts are kept (to check that nothing piles up)
export const prefetchedCount = () => bodies.size
