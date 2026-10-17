import { useEffect, type RefObject } from 'react'

// Phone: swipe left from the right edge opens the Board, swipe right on the open Board closes
// it. Only fires once the finger has moved far enough, mostly sideways (a scroll stays a scroll).
// The Board then slides in with its usual animation; it doesn't follow the finger.

const EDGE = 40 // px from the right edge where an opening swipe may start
const DISTANCE = 50 // px the finger must move sideways
const isNarrowScreen = () => window.matchMedia('(max-width: 699px)').matches

export function useBoardSwipe(
  area: RefObject<HTMLElement | null>,
  boardOpen: boolean,
  sidebarOpen: boolean,
  setBoardOpen: (open: boolean) => void,
) {
  useEffect(() => {
    const el = area.current
    if (!el) return
    let start: { x: number; y: number } | null = null

    const onStart = (e: TouchEvent) => {
      start = null
      if (e.touches.length !== 1 || !isNarrowScreen() || sidebarOpen) return
      const { clientX: x, clientY: y } = e.touches[0]
      const target = e.target as Element
      const onBoard = !!target.closest('.board, .backdrop')
      if (boardOpen ? onBoard : x > window.innerWidth - EDGE) start = { x, y }
    }

    const onMove = (e: TouchEvent) => {
      if (!start) return
      // A card being moved (Board.tsx) isn't a swipe
      if (document.querySelector('.board-cards.dragging')) {
        start = null
        return
      }
      const dx = e.touches[0].clientX - start.x
      const dy = e.touches[0].clientY - start.y
      if (Math.abs(dy) > Math.abs(dx)) {
        if (Math.abs(dy) > 10) start = null // it's a scroll
        return
      }
      if (!boardOpen && dx < -DISTANCE) {
        start = null
        setBoardOpen(true)
      } else if (boardOpen && dx > DISTANCE) {
        start = null
        setBoardOpen(false)
      }
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
    }
  }, [area, boardOpen, sidebarOpen, setBoardOpen])
}
