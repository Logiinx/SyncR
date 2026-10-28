import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ExternalLink, ImageOff, Mail, Moon, Sun } from 'lucide-react'
import { openLink } from './links'
import { accountColor, MailButtons } from './MailCards'
import { fetchMailBody, type MailAction, type MailAlert, type MailBody } from './mailAlerts'
import { formatDue } from './reminders'
import Spinner from './Spinner'

// A mail opened to read, in the desktop pop-up (which grows into a bigger window meanwhile,
// ReminderPopup.tsx). Head: back to the list, when + account, sender, subject, open in Gmail.
// Then the mail, then Done · Mark as unread.
// The mail shows in a sandboxed frame: no scripts run, and a content policy blocks anything
// from the web (images, fonts, styles: they can tell the sender you opened it) until "Show
// images". Links open in the normal browser. HTML mails show dark like a note (light text,
// no backgrounds, links in the notes' blue); "Show original" brings back the sender's design
// for this opening.
function MailReader({ alert, onAction, onBack }: {
  alert: MailAlert
  onAction: (action: MailAction) => void
  onBack: () => void
}) {
  const [body, setBody] = useState<MailBody | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [images, setImages] = useState(false)
  const [original, setOriginal] = useState(false)
  const frameRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    setBody(null)
    setError(null)
    setImages(false)
    setOriginal(false)
    fetchMailBody(alert).then(setBody, (e) => setError(e instanceof Error ? e.message : String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert.key])

  const dark = !!body && !body.plain && !original
  const doc = useMemo(() => body && frameDocument(body, images, dark), [body, images, dark])

  // Links in the mail open in the browser (the frame itself never navigates)
  function onFrameLoad() {
    frameRef.current?.contentDocument?.addEventListener('click', (e) => {
      const link = (e.target as Element).closest?.('a[href]')
      if (!link) return
      e.preventDefault()
      openLink((link as HTMLAnchorElement).href)
    })
  }

  return (
    <div className="reminder-alert mail-reader" style={{ borderLeftColor: accountColor(alert.account) }}>
      <div className="mail-reader-head">
        <button className="mail-reader-icon" onClick={onBack} title="Back to the list" aria-label="Back to the list">
          <ArrowLeft size={16} />
        </button>
        <div className="mail-reader-title">
          <span className="reminder-alert-due">
            <Mail size={12} /> {formatDue(alert.date)} · <span className="mail-alert-account">{alert.account}</span>
          </span>
          <span className="reminder-alert-text">{alert.from}</span>
          <span className="mail-alert-subject">{alert.subject}</span>
        </div>
        <button
          className="mail-reader-icon"
          onClick={() => onAction('mail-open')}
          title="Open in Gmail"
          aria-label="Open in Gmail"
        >
          <ExternalLink size={16} />
        </button>
      </div>
      {body && (!body.plain || (body.remoteImages && !images)) && (
        <div className="mail-reader-images">
          {body.remoteImages && !images && (
            <>
              <ImageOff size={14} /> Images from the web are blocked.
              <button onClick={() => setImages(true)}>Show images</button>
            </>
          )}
          {!body.plain && (
            <button onClick={() => setOriginal(!original)} title={original ? 'Show it dark, like a note' : "Show the sender's design (on white)"}>
              {original ? <Moon size={12} /> : <Sun size={12} />} {original ? 'Show dark' : 'Show original'}
            </button>
          )}
        </div>
      )}
      {doc ? (
        <iframe
          ref={frameRef}
          className={`mail-reader-frame${body?.plain || dark ? '' : ' html'}`}
          title="Email"
          sandbox="allow-same-origin" // no scripts; lets SyncR catch link clicks
          srcDoc={doc}
          onLoad={onFrameLoad}
        />
      ) : (
        <div className="mail-reader-status">{error ?? <Spinner size={16} />}</div>
      )}
      <MailButtons opened onAction={onAction} />
    </div>
  )
}

// The frame's page: a content policy (blocks the web unless images are shown), base styles
// (plain text and dark HTML in the app's colors, the original HTML on white, as it's made
// for it), then the mail, cleaned of what could act on its own (scripts, forms, refresh,
// frames). Dark: the mail's own colors and backgrounds are overridden (images stay).
function frameDocument(body: MailBody, images: boolean, dark: boolean) {
  const web = images ? ' https: http:' : ''
  const policy = `default-src 'none'; style-src 'unsafe-inline'${web}; img-src data:${web}; font-src data:${web}`
  const app = getComputedStyle(document.documentElement)
  const [bg, text, link, border] = ['--bg-raised', '--text', '--link', '--border'].map((name) => app.getPropertyValue(name))
  const colors = body.plain || dark ? `background: ${bg}; color: ${text};` : 'background: #fff; color: #222;'
  const links = body.plain ? `a { color: ${link}; }`
    : dark ? `body > div, body > div * { background-color: transparent !important; color: ${text} !important; border-color: ${border} !important; }
  body > div a, body > div a * { color: ${link} !important; }`
    : ''
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<style>
  html, body { margin: 0; }
  body { font: 14px/1.5 system-ui, sans-serif; overflow-wrap: anywhere; ${colors} }
  body > div { min-height: 100vh; padding: 12px 14px; box-sizing: border-box; }
  img { max-width: 100%; height: auto; }
  img[src^="cid:"] { display: none; }
  pre { margin: 0; font: inherit; white-space: pre-wrap; }
  ${links}
</style>
${cleanHtml(body.html)}`
}

// The mail's own styles and body, without scripts, forms, frames, <meta> (refresh), <base>
// and <link> (outside styles). The body's own color, style and class are kept on a wrapper
// that fills the page.
function cleanHtml(html: string) {
  const parsed = new DOMParser().parseFromString(html, 'text/html') // scripts don't run here
  parsed.querySelectorAll('script, noscript, form, iframe, frame, object, embed, meta, base, link').forEach((el) => el.remove())
  const styles = [...parsed.querySelectorAll('style')].map((el) => el.outerHTML).join('')
  parsed.querySelectorAll('style').forEach((el) => el.remove())
  const wrapper = parsed.createElement('div')
  const bgcolor = parsed.body.getAttribute('bgcolor') // old-style page color: only works on <body>
  wrapper.setAttribute('style', `${bgcolor ? `background-color: ${bgcolor}; ` : ''}${parsed.body.getAttribute('style') ?? ''}`)
  const className = parsed.body.getAttribute('class')
  if (className) wrapper.setAttribute('class', className)
  wrapper.innerHTML = parsed.body.innerHTML
  return `${styles}</head><body>${wrapper.outerHTML}</body></html>`
}

export default MailReader
