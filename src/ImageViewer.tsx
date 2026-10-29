import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { currentZoom } from './appearance'

// Opens the full-screen view of an image (an image clicked in a note, image.ts, or in an
// email, MailReader.tsx)
export function openImageViewer(url: string) {
  window.dispatchEvent(new CustomEvent('open-image', { detail: url }))
}

// Full-screen image view, fitted to the window (never bigger than its real size). The scroll
// wheel zooms around the mouse (fitted up to 8× real size); zoomed in, drag to move it. Click
// the image: fit ↔ real size (around the click). Close: click the dark area, ✕, Escape, or the
// phone's back button. Mounted once per window (App.tsx, ReminderPopup.tsx).
// Sizes are in screen pixels (mouse, window), divided by the app scaling when drawn.

const MARGIN = 16 // screen px around the fitted image
const MAX_SCALE = 8

interface View {
  scale: number // screen px per image px
  x: number // the image's top left corner, screen px
  y: number
}

interface Press {
  x: number
  y: number
  from: View
  onImage: boolean
  moved: boolean
}

function ImageViewer() {
  const [url, setUrl] = useState<string | null>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null) // the image's real size
  const [view, setViewState] = useState<View | null>(null)
  // The latest view at once: wheel steps can come faster than the screen redraws
  const viewNow = useRef<View | null>(null)
  const setView = (next: View | null) => {
    viewNow.current = next
    setViewState(next)
  }
  const overlay = useRef<HTMLDivElement>(null)
  const press = useRef<Press | null>(null)

  useEffect(() => {
    const onOpen = (e: Event) => {
      setUrl((e as CustomEvent<string>).detail)
      setSize(null)
      setView(null)
      // An extra history entry, so the phone's back button closes the viewer
      // instead of leaving the app
      history.pushState({ imageViewer: true }, '')
    }
    const onBack = () => setUrl(null)
    window.addEventListener('open-image', onOpen)
    window.addEventListener('popstate', onBack)
    return () => {
      window.removeEventListener('open-image', onOpen)
      window.removeEventListener('popstate', onBack)
    }
  }, [])

  // Escape closes it, before anything else gets it (an open email would go back to the list).
  // The viewer takes the keyboard, which may be inside an email's frame after the click.
  useEffect(() => {
    if (!url) return
    overlay.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [url])

  // Going back removes the extra history entry; popstate then hides the viewer
  function close() {
    history.back()
  }

  // Fitted and centered in the window
  function fitted(): View {
    const { w, h } = size!
    const scale = Math.min(1, (innerWidth - MARGIN * 2) / w, (innerHeight - MARGIN * 2) / h)
    return { scale, x: (innerWidth - w * scale) / 2, y: (innerHeight - h * scale) / 2 }
  }

  // Zoomed to `scale` (kept between fitted and the maximum), the spot at (x, y) staying put
  function zoomTo(scale: number, x: number, y: number) {
    const view = viewNow.current
    if (!size || !view) return
    const fit = fitted()
    scale = Math.min(MAX_SCALE, Math.max(fit.scale, scale))
    if (scale === fit.scale) return setView(fit) // back to fitted: centered again
    const k = scale / view.scale
    setView({ scale, x: x - (x - view.x) * k, y: y - (y - view.y) * k })
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 || !view || (e.target as Element).closest('.image-viewer-close')) return
    press.current = { x: e.clientX, y: e.clientY, from: view, onImage: e.target instanceof HTMLImageElement, moved: false }
    overlay.current?.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent) {
    const p = press.current
    if (!p || !size) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    if (!p.moved && Math.hypot(dx, dy) < 4) return
    p.moved = true
    // Only a zoomed-in image moves
    if (p.from.scale > fitted().scale) setView({ ...p.from, x: p.from.x + dx, y: p.from.y + dy })
  }

  function onPointerUp(e: React.PointerEvent) {
    const p = press.current
    press.current = null
    if (!p || p.moved || !view) return
    if (!p.onImage) return close()
    // A click on the image: real size around the click, or back to fitted
    zoomTo(view.scale > fitted().scale ? 0 : 1, e.clientX, e.clientY)
  }

  if (!url) return null
  const zoom = currentZoom()
  const zoomed = !!size && !!view && view.scale > fitted().scale
  return (
    <div
      ref={overlay}
      className={zoomed ? 'image-viewer zoomed' : 'image-viewer'}
      tabIndex={-1}
      onWheel={(e) => viewNow.current && zoomTo(viewNow.current.scale * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (press.current = null)}
    >
      <div className="image-viewer-stage">
        <img
          src={url}
          alt=""
          draggable={false}
          onLoad={(e) => {
            const { naturalWidth: w, naturalHeight: h } = e.currentTarget
            const scale = Math.min(1, (innerWidth - MARGIN * 2) / w, (innerHeight - MARGIN * 2) / h)
            setSize({ w, h })
            setView({ scale, x: (innerWidth - w * scale) / 2, y: (innerHeight - h * scale) / 2 })
          }}
          style={
            size && view
              ? {
                  width: size.w,
                  height: size.h,
                  transform: `translate(${view.x / zoom}px, ${view.y / zoom}px) scale(${view.scale / zoom})`,
                }
              : { visibility: 'hidden' }
          }
        />
      </div>
      <button className="image-viewer-close" aria-label="Close" title="Close (Esc)" onClick={close}>
        <X size={18} />
      </button>
    </div>
  )
}

export default ImageViewer
