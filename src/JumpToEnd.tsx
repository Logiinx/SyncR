import { useEffect, useRef, useState, type RefObject } from 'react'
import { ArrowDownToLine } from 'lucide-react'
import { animationsOn } from './animations'
import { deviceName } from './device'

// Phone: a round button at the note's bottom right that jumps to the end. It fades in while you
// scroll and are far from the end, and fades out again soon after, so it doesn't sit on the text.
// Not while the keyboard is open.

const HIDE_AFTER_MS = 2000
const TOUCH_MS = 1500 // a flicked page goes on scrolling a while after the finger left

// The keyboard shrinks the window (interactive-widget=resizes-content, index.html)
const keyboardOpen = () => window.innerHeight < screen.height * 0.75

function JumpToEnd({ pageRef, noteId }: { pageRef: RefObject<HTMLElement | null>; noteId: string }) {
  const [show, setShow] = useState(false)
  const hideTimer = useRef<number | undefined>(undefined)
  // Only scrolling by finger counts, not the note opening at its saved spot or the jump itself
  const lastTouch = useRef(0)

  useEffect(() => {
    const page = pageRef.current
    if (!page) return
    const touched = () => {
      lastTouch.current = performance.now()
    }
    const hide = () => {
      window.clearTimeout(hideTimer.current)
      setShow(false)
    }
    const onScroll = () => {
      if (performance.now() - lastTouch.current > TOUCH_MS) return
      const left = page.scrollHeight - page.scrollTop - page.clientHeight
      if (left < page.clientHeight / 2 || keyboardOpen()) return hide()
      setShow(true)
      window.clearTimeout(hideTimer.current)
      hideTimer.current = window.setTimeout(() => setShow(false), HIDE_AFTER_MS)
    }
    const onResize = () => keyboardOpen() && hide()
    page.addEventListener('touchstart', touched, { passive: true })
    page.addEventListener('touchmove', touched, { passive: true })
    page.addEventListener('touchend', touched, { passive: true })
    page.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    return () => {
      hide()
      page.removeEventListener('touchstart', touched)
      page.removeEventListener('touchmove', touched)
      page.removeEventListener('touchend', touched)
      page.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
    }
  }, [pageRef, noteId])

  function jump() {
    lastTouch.current = 0
    window.clearTimeout(hideTimer.current)
    setShow(false)
    pageRef.current?.scrollTo({ top: pageRef.current.scrollHeight, behavior: animationsOn() ? 'smooth' : 'auto' })
  }

  return (
    <button
      type="button"
      className={`jump-to-end${show ? ' visible' : ''}`}
      title="Jump to the end of the note"
      aria-label="Jump to the end of the note"
      tabIndex={show ? 0 : -1}
      // Keep the cursor in the note
      onMouseDown={(e) => e.preventDefault()}
      onClick={jump}
    >
      <ArrowDownToLine size={18} />
    </button>
  )
}

// Only on a phone
export default function JumpToEndOnPhone(props: { pageRef: RefObject<HTMLElement | null>; noteId: string }) {
  return deviceName() === 'phone' ? <JumpToEnd {...props} /> : null
}
