import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { t } from './i18n'
import { currentZoom } from './appearance'
import { trailerAddress } from './videoPlayer'

// A game's trailer in SyncR's own YouTube player (the trailer view, PC, where the Video tab
// shows): our controls, the video window's extensions. The player is a page of its own laid over
// this black box (trailer_player.rs), so it can't fade or slide with the view: it comes once the
// view's opening animation is over, and hides while something of SyncR's covers the box (a page
// always lies above the window's own). Escape on it goes back, like on the view.
export default function TrailerPlayer({ youtubeId, onBack }: { youtubeId: string; onBack: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [refused, setRefused] = useState(false)
  const back = useRef(onBack)
  back.current = onBack

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    let stopped = false
    let opened = false
    let shown = true
    let frame = 0
    // The box in the window's pixels, and its bottom corners' radius (the view's, inside its border)
    const spot = () => {
      const rect = box.getBoundingClientRect()
      const scale = devicePixelRatio
      const view = box.closest<HTMLElement>('.trailer-theater')
      const style = view ? getComputedStyle(view) : null
      const radius = style ? Math.max(0, parseFloat(style.borderBottomLeftRadius) - parseFloat(style.borderBottomWidth)) : 0
      return {
        x: Math.round(rect.left * scale),
        y: Math.round(rect.top * scale),
        width: Math.round(rect.width * scale),
        height: Math.round(rect.height * scale),
        radius: Math.round(radius * currentZoom() * scale),
      }
    }
    // Covered: some spots of the box show something else on top. Kept away from the edges, so a
    // tooltip from the header just over it doesn't hide the video.
    const covered = () => {
      const rect = box.getBoundingClientRect()
      for (const fx of [0.15, 0.5, 0.85]) {
        for (const fy of [0.15, 0.5, 0.85]) {
          if (document.elementFromPoint(rect.left + rect.width * fx, rect.top + rect.height * fy) !== box) return true
        }
      }
      return false
    }
    // Not once the view is going (its box left the page before this effect ends)
    const live = () => opened && !stopped && box.isConnected
    const check = () => {
      frame = 0
      if (!live()) return
      const show = !covered()
      if (show !== shown) {
        shown = show
        void invoke('show_trailer_player', { show })
      }
    }
    const later = () => {
      if (!frame) frame = requestAnimationFrame(check)
    }
    const place = () => {
      if (live()) void invoke('place_trailer_player', spot())
      later()
    }
    const resized = new ResizeObserver(place)
    const changes = new MutationObserver(later)
    const unlisten = [
      listen('trailer-back', () => back.current()),
      // The video's real shape: the box (and the view's width) take it instead of 16:9. Not
      // narrower than 4:3, so the header keeps its room (a tall video gets bars on its sides).
      listen<number>('trailer-shape', ({ payload }) => {
        const view = box.closest<HTMLElement>('.trailer-theater')
        if (view && payload > 0 && payload <= 5) view.style.setProperty('--trailer-ratio', String(Math.max(payload, 4 / 3)))
      }),
      listen('trailer-refused', () => {
        opened = false // nothing more to place or show
        setRefused(true)
        void invoke('close_trailer_player')
      }),
    ]
    // After the view's opening animation (none with animations off)
    const animations = box.closest('.dialog-backdrop')?.getAnimations({ subtree: true }) ?? []
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(async () => {
      if (stopped) return
      await invoke('open_trailer_player', { address: trailerAddress(youtubeId), ...spot() })
      if (stopped) return void invoke('close_trailer_player') // closed while it opened
      opened = true
      resized.observe(box)
      changes.observe(document.body, { childList: true, subtree: true, attributes: true })
      addEventListener('resize', place)
      check()
    }).catch((error) => {
      console.error('Trailer player failed', error)
      setRefused(true)
    })
    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      resized.disconnect()
      changes.disconnect()
      removeEventListener('resize', place)
      for (const stop of unlisten) void stop.then((off) => off())
      void invoke('close_trailer_player')
    }
  }, [youtubeId])

  return (
    <div ref={boxRef} className="trailer-own">
      {refused && <p>{t("This trailer can't play here")}</p>}
    </div>
  )
}
