import { read, write } from './localState'

// Safe senders: their emails open with web images shown (MailReader.tsx). Kept on this PC only
// (Mail is PC only, nothing of it goes to Dropbox). A company is trusted by its main domain
// (news.amazon.com → amazon.com: they send from many addresses); a free mail service by the
// exact address (trusting gmail.com would trust everyone on it).

const KEY = 'mail-safe-senders'

// Free mail services: anyone can have an address there
const FREE_MAIL = /^(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|aol|icloud|me|mac|proton|protonmail|pm|gmx|web|mail|yandex|zoho|laposte|orange|free|sfr|wanadoo|libero|t-online)\./

// Endings that take two parts (example.co.uk → main domain example.co.uk, not co.uk)
const TWO_PART_END = /\.(co|com|org|net|gov|ac|edu|ne|or|go)\.[a-z]{2}$/

// "Jane <jane@example.com>" or a bare address → jane@example.com (lower case), else ''
export function senderAddress(from: string) {
  const address = (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase()
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address) ? address : ''
}

// What "Always" trusts for this address: its main domain, or the address on a free mail service
export function trustFor(address: string) {
  const domain = address.split('@')[1] ?? ''
  const parts = domain.split('.')
  const main = parts.slice(TWO_PART_END.test(domain) ? -3 : -2).join('.')
  return FREE_MAIL.test(main) ? address : main
}

export const loadSafeSenders = () => read<string[]>(KEY, [])

export function isSafeSender(address: string) {
  return !!address && loadSafeSenders().includes(trustFor(address))
}

export function addSafeSender(entry: string) {
  const list = loadSafeSenders()
  if (!list.includes(entry)) write(KEY, [...list, entry].sort())
}

export function removeSafeSender(entry: string) {
  write(KEY, loadSafeSenders().filter((e) => e !== entry))
}

// ---------- Trackers ----------

// Known "email opened" pixels of mailing services (Mailchimp, SendGrid, Mandrill, Amazon SES,
// HubSpot, Brevo, Salesforce, Constant Contact, Mailtrack, Yesware, Mixmax, Superhuman…)
const TRACKER_URL = new RegExp(
  [
    /list-manage\.com\/track\/open/,
    /\/wf\/open\?/,
    /mandrillapp\.com\/track\/open/,
    /awstrack\.me\/I0\//,
    /hubspotemail\.net\/.*\/(e2t|to)\//,
    /track\.hubspot\.com/,
    /sendibt\d*\.com\/tr\/op\//,
    /exct\.net\/open\.aspx/,
    /rs6\.net\/on\.jsp/,
    /mailtrack\.io\/trace/,
    /t\.yesware\.com/,
    /mixmax\.com\/api\/track/,
    /r\.superhuman\.com/,
    /\/(track|tracking)\/open\b/,
    /\/open\.(gif|png|aspx|php)\b/,
  ]
    .map((r) => r.source)
    .join('|'),
  'i',
)

// A size from width="1", or style "width: 1px"
function size(img: Element, name: 'width' | 'height') {
  const style = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([\\d.]+)px`, 'i').exec(img.getAttribute('style') ?? '')
  const value = style?.[1] ?? img.getAttribute(name)
  return value == null || value === '' ? null : parseFloat(value)
}

// A web image that's only there to tell the sender the email was opened: tiny (1–3 px both
// ways), hidden by its style, or from a known tracker. A normal-size image with a personal code
// in its address can't be told apart from a real one.
export function isTracker(img: Element) {
  const src = img.getAttribute('src') ?? ''
  if (!/^\s*https?:/i.test(src)) return false
  if (TRACKER_URL.test(src)) return true
  const w = size(img, 'width')
  const h = size(img, 'height')
  if (w != null && h != null && w <= 3 && h <= 3) return true
  const style = (img.getAttribute('style') ?? '').toLowerCase().replace(/\s/g, '')
  return /(^|;)(display:none|visibility:hidden|opacity:0(?![.\d])|(max-)?(width|height):0(px)?(?![.\d%]))/.test(style)
}
