import { currentZoom } from './appearance'

export const MENU_EDGE = 8 // px kept free between a menu and the window's edge

// A menu at x / y, screen pixels (mouse position): kept inside the window from its real size, and
// converted to the zoomed page (app scaling). alignRight / above: x / y is where it ends instead.
// Used by ContextMenu and TableMenu.
export function placeMenu(el: HTMLElement, x: number, y: number, alignRight = false, above = false) {
  const zoom = currentZoom()
  el.style.left = el.style.top = '0'
  const { width, height } = el.getBoundingClientRect()
  const left = alignRight ? x - width : x
  const top = above ? y - height : y
  el.style.left = `${Math.max(MENU_EDGE, Math.min(left, window.innerWidth - width - MENU_EDGE)) / zoom}px`
  el.style.top = `${Math.max(MENU_EDGE, Math.min(top, window.innerHeight - height - MENU_EDGE)) / zoom}px`
}
