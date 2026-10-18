import { useEffect, type RefObject } from 'react'

// Phone: swipe left from the right side opens the Board, swipe right from the left side opens
// the sidebar. Swiping the open panel back toward its edge closes it. Only fires once the finger
// has moved far enough, mostly sideways (a scroll stays a scroll). The panel then slides in with
// its usual animation; it doesn't follow the finger.

// An opening swipe may start anywhere in the outer third of the screen on that side: Android's
// gesture navigation takes swipes that start right at the edge as "Back", and pages can't prevent that
const EDGE_PART = 1 / 3
const DISTANCE = 50 // px the finger must move sideways
const isNarrowScreen = () => window.matchMedia('(max-width: 699px)').matches

export function usePanelSwipe(
  area: RefObject<HTMLElement | null>,
  boardOpen: boolean,
  sidebarOpen: boolean,
  setBoardOpen: (open: boolean) => void,
  setSidebarOpen: (open: boolean) => void,
) {
  useEffect(() => {
    const el = area.current
    if (!el) return
    let start: { x: number; y: number } | null = null

    const onStart = (e: TouchEvent) => {
      start = null
      if (e.touches.length !== 1 || !isNarrowScreen()) return
      const { clientX: x, clientY: y } = e.touches[0]
      const target = e.target as Element
      // Both panels cover the note with the same backdrop; only one is open at a time here
      const onPanel = !!target.closest('.board, .sidebar, .backdrop')
      // A wide table scrolls sideways: a swipe there is meant for the table
      const inTable = !!target.closest('.tableWrapper')
      const nearEdge = x > window.innerWidth * (1 - EDGE_PART) || x < window.innerWidth * EDGE_PART
      if (boardOpen || sidebarOpen ? onPanel : !inTable && nearEdge) start = { x, y }
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
      if (Math.abs(dx) < DISTANCE) return
      const left = dx < 0
      const fromRight = start.x > window.innerWidth / 2
      start = null
      if (boardOpen) {
        if (!left) setBoardOpen(false)
      } else if (sidebarOpen) {
        if (left) setSidebarOpen(false)
      } else if (left && fromRight) {
        setBoardOpen(true)
      } else if (!left && !fromRight) {
        setSidebarOpen(true)
      }
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
    }
  }, [area, boardOpen, sidebarOpen, setBoardOpen, setSidebarOpen])
}
