import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, ImageOff, Mail, Moon, ShieldCheck, Sun } from 'lucide-react'
import BackButton from './BackButton'
import { openImageViewer } from './ImageViewer'
import MailFilesRow from './MailFilesRow'
import { openLink } from './links'
import { accountColor, MailButtons } from './MailCards'
import { fetchMailBody, type MailAction, type MailAlert, type MailBody } from './mailAlerts'
import { darkenMail } from './mailDark'
import { formatDue } from './reminders'
import { addSafeSender, isSafeSender, isTracker, trustFor } from './safeSenders'
import Spinner from './Spinner'

// A mail opened to read, in the desktop pop-up (which grows into a bigger window meanwhile,
// ReminderPopup.tsx). Head: ‹ Back (to the list), when + account, sender, subject, open in Gmail.
// Then the mail, then Done · Mark as unread.
// The mail shows in a sandboxed frame: no scripts run, and a content policy blocks anything
// from the web (images, fonts, styles: they can tell the sender you opened it) until "Show
// images". Links open in the normal browser. HTML mails show dark: the mail's own dark
// version, or its light colors turned dark (mailDark.ts); "Show original" brings back the
// sender's light design for this opening (not offered when it's the same: a mail made dark).
// The pop-up prepares the reader unseen (loadBody: the text it already downloaded) and only
// shows it once onReady is called: after the first load, with how many pixels wider the mail
// is than the frame (0 if it fits or couldn't load). It returns the pixels it gives (the pop-up
// grows); fitWidth: what's still too wide is scaled down, so it only scrolls up and down.
function MailReader({ alert, onAction, onBack, loadBody = fetchMailBody, fitWidth = false, onReady }: {
  alert: MailAlert
  onAction: (action: MailAction) => void
  onBack: () => void
  loadBody?: (alert: MailAlert) => Promise<MailBody>
  fitWidth?: boolean
  onReady?: (extra: number) => number
}) {
  const [body, setBody] = useState<MailBody | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [images, setImages] = useState(false)
  const [original, setOriginal] = useState(false)
  const [ready, setReady] = useState(false) // the frame is shown once its colors are done
  const [alreadyDark, setAlreadyDark] = useState(false) // dark mode changed nothing
  const frameRef = useRef<HTMLIFrameElement>(null)
  const readyFor = useRef<string | null>(null) // the mail onReady was called for
  const tellReady = (extra: number) => {
    if (readyFor.current === alert.key) return 0
    readyFor.current = alert.key
    return onReady?.(extra) ?? 0
  }

  useEffect(() => {
    setBody(null)
    setError(null)
    setImages(false)
    setOriginal(false)
    setAlreadyDark(false)
    loadBody(alert).then(setBody, (e) => {
      setError(e instanceof Error ? e.message : String(e))
      tellReady(0)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert.key])

  const dark = !!body && !body.plain && !original
  // A safe sender's mail opens with its web images (safeSenders.ts)
  const showImages = images || (!!body && isSafeSender(body.sender))
  const frame = useMemo(() => body && frameDocument(body, showImages, dark), [body, showImages, dark])
  const doc = frame?.doc
  useEffect(() => setReady(false), [doc])

  // The frame changes width (window resized): fit the mail again
  useEffect(() => {
    const frame = frameRef.current
    if (!fitWidth || !frame) return
    const observer = new ResizeObserver(() => frame.contentDocument && fitToWidth(frame.contentDocument))
    observer.observe(frame)
    return () => observer.disconnect()
  }, [fitWidth, doc])

  // Links in the mail open in the browser (the frame itself never navigates). Pictures that
  // aren't links and aren't tiny (icons, small logos) open full size (ImageViewer.tsx).
  function onFrameLoad() {
    const frameDoc = frameRef.current?.contentDocument
    if (!frameDoc) return
    if (dark) {
      const changed = darkenMail(frameDoc)
      // A mail with its own dark version still differs from its original
      if (!changed && !/prefers-color-scheme/i.test(body?.html ?? '')) setAlreadyDark(true)
    }
    const page = frameDoc.documentElement
    const extra = fitWidth ? Math.max(0, page.scrollWidth - page.clientWidth) : 0
    // Given more room: the frame grows with the pop-up (its size observer above fits what's
    // left); no sideways scrollbar meanwhile
    if (tellReady(extra) > 0) page.style.overflowX = 'hidden'
    else if (fitWidth) fitToWidth(frameDoc)
    setReady(true)
    frameDoc.querySelectorAll('img').forEach((img) => {
      const mark = () => viewable(img) && img.classList.add('viewable')
      if (img.complete) mark()
      else img.addEventListener('load', mark, { once: true })
    })
    frameDoc.addEventListener('click', (e) => {
      const target = e.target as Element
      const link = target.closest?.('a[href]')
      if (link) {
        e.preventDefault()
        openLink((link as HTMLAnchorElement).href)
      } else if (target instanceof frameDoc.defaultView!.HTMLImageElement && viewable(target)) {
        openImageViewer(target.currentSrc || target.src)
      }
    })
  }

  return (
    <div className="reminder-alert mail-reader" style={{ borderLeftColor: accountColor(alert.account) }}>
      <div className="mail-reader-head">
        <BackButton onClick={onBack} title="Back to the list" />
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
      {body && (!body.plain || (body.remoteImages && !showImages)) && (
        <div className="mail-reader-images">
          {body.remoteImages && !showImages && (
            <span className="mail-reader-note">
              <ImageOff size={14} /> Web images blocked.
            </span>
          )}
          {showImages && !!frame?.trackers && (
            <span className="mail-reader-note" title="Hidden images that tell the sender the email was opened: not loaded">
              <ShieldCheck size={13} /> {frame.trackers} {frame.trackers === 1 ? 'tracker' : 'trackers'} blocked
            </span>
          )}
          <div className="mail-reader-image-buttons">
            {body.remoteImages && !showImages && <button onClick={() => setImages(true)}>Show images</button>}
            {body.remoteImages && !showImages && body.sender && (
              <button
                className="mail-reader-always"
                title={`Always show images in emails from ${trustFor(body.sender)}`}
                onClick={() => {
                  addSafeSender(trustFor(body.sender))
                  setImages(true)
                }}
              >
                <span>Always for {trustFor(body.sender)}</span>
              </button>
            )}
            {!body.plain && !alreadyDark && (
              <button onClick={() => setOriginal(!original)} title={original ? 'Show it dark, like a note' : "Show the sender's design (on white)"}>
                {original ? <Moon size={12} /> : <Sun size={12} />} {original ? 'Show dark' : 'Show original'}
              </button>
            )}
          </div>
        </div>
      )}
      {doc ? (
        <iframe
          ref={frameRef}
          className={`mail-reader-frame${body?.plain || dark ? '' : ' html'}`}
          // Dark: asks the mail for its own dark version (prefers-color-scheme); hidden until
          // its colors are done, so it never flashes white
          style={{ colorScheme: body?.plain || dark ? 'dark' : 'light', visibility: ready ? undefined : 'hidden' }}
          title="Email"
          sandbox="allow-same-origin" // no scripts; lets SyncR catch link clicks
          srcDoc={doc}
          onLoad={onFrameLoad}
        />
      ) : (
        <div className="mail-reader-status">{error ?? <Spinner size={16} />}</div>
      )}
      {body && <MailFilesRow key={alert.key} alert={alert} files={body.files} />}
      <MailButtons opened onAction={onAction} />
    </div>
  )
}

// A picture worth opening full size: not inside a link, at least 50 px both ways (real size)
const viewable = (img: HTMLImageElement) =>
  !img.closest('a[href]') && img.naturalWidth >= 50 && img.naturalHeight >= 50

// Scales the mail down (CSS zoom, so the page gets shorter too) when it's wider than the frame
function fitToWidth(doc: Document) {
  const page = doc.documentElement
  if (!doc.body) return // not loaded yet
  doc.body.style.zoom = ''
  page.style.overflowX = ''
  const room = page.clientWidth
  const wide = page.scrollWidth
  if (!room || wide <= room) return
  doc.body.style.zoom = String(room / wide)
  page.style.overflowX = 'hidden' // a pixel left over by rounding
}

// The frame's page: a content policy (blocks the web unless images are shown), base styles
// (plain text and dark HTML in the app's colors, the original HTML on white, as it's made
// for it), then the mail, cleaned of what could act on its own (scripts, forms, refresh,
// frames). Dark: the mail's colors are turned dark once it's loaded (onFrameLoad).
function frameDocument(body: MailBody, images: boolean, dark: boolean) {
  const { html, trackers } = cleanHtml(body.html)
  const web = images ? ' https: http:' : ''
  const policy = `default-src 'none'; style-src 'unsafe-inline'${web}; img-src data:${web}; font-src data:${web}`
  const app = getComputedStyle(document.documentElement)
  const [bg, text, link] = ['--bg-raised', '--text', '--link'].map((name) => app.getPropertyValue(name))
  const colors = body.plain || dark ? `background: ${bg}; color: ${text};` : 'background: #fff; color: #222;'
  const links = body.plain ? `a { color: ${link}; }` : ''
  const doc = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<style>
  html, body { margin: 0; }
  body { font: 14px/1.5 system-ui, sans-serif; overflow-wrap: anywhere; ${colors} }
  body > div { min-height: 100vh; padding: 12px 14px; box-sizing: border-box; }
  img { max-width: 100%; height: auto; }
  img[src^="cid:"] { display: none; }
  img.viewable { cursor: zoom-in; }
  pre { margin: 0; font: inherit; white-space: pre-wrap; }
  ${links}
</style>
${html}`
  return { doc, trackers }
}

// The mail's own styles and body, without scripts, forms, frames, <meta> (refresh), <base>,
// <link> (outside styles) and tracking pixels (counted, for "N trackers blocked"). The body's
// own color, style and class are kept on a wrapper that fills the page.
function cleanHtml(html: string) {
  const parsed = new DOMParser().parseFromString(html, 'text/html') // scripts don't run here
  parsed.querySelectorAll('script, noscript, form, iframe, frame, object, embed, meta, base, link').forEach((el) => el.remove())
  // Tracking pixels never load, even with images shown (safeSenders.ts)
  const trackers = [...parsed.querySelectorAll('img')].filter(isTracker)
  trackers.forEach((el) => el.remove())
  const styles = [...parsed.querySelectorAll('style')].map((el) => el.outerHTML).join('')
  parsed.querySelectorAll('style').forEach((el) => el.remove())
  const wrapper = parsed.createElement('div')
  const bgcolor = parsed.body.getAttribute('bgcolor') // old-style page color: only works on <body>
  wrapper.setAttribute('style', `${bgcolor ? `background-color: ${bgcolor}; ` : ''}${parsed.body.getAttribute('style') ?? ''}`)
  const className = parsed.body.getAttribute('class')
  if (className) wrapper.setAttribute('class', className)
  wrapper.innerHTML = parsed.body.innerHTML
  return { html: `${styles}</head><body>${wrapper.outerHTML}</body></html>`, trackers: trackers.length }
}

export default MailReader
