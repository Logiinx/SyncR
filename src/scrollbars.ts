// Scrollbars stay invisible until you scroll, then fade out a moment after you stop.
// With the mouse over a scrollbar it stays visible, so it can still be grabbed.
// Only the look changes (CSS: the thumb color, `--thumb`); the bar's space stays reserved,
// so text doesn't shift. Mouse screens only: phones already show scrollbars only while scrolling.
// Not inside notes (wide tables, code blocks): changing those elements would make the editor
// re-read them, and they keep their normal scrollbars.

const HIDE_MS = 1000 // after the last scroll
const VISIBLE = 'scrollbar-visible'

const timers = new WeakMap<Element, number>()
let hovered: Element | null = null // the element whose scrollbar the mouse is on

function show(el: Element) {
  if (el.closest('.tiptap')) return
  el.classList.add(VISIBLE)
  window.clearTimeout(timers.get(el))
  timers.set(
    el,
    window.setTimeout(() => {
      if (el !== hovered) el.classList.remove(VISIBLE)
    }, HIDE_MS),
  )
}

// Is the pointer on this element's vertical scrollbar?
function onScrollbar(el: Element, x: number) {
  if (el.scrollHeight <= el.clientHeight) return false
  const rect = el.getBoundingClientRect()
  return x >= rect.left + el.clientLeft + el.clientWidth && x <= rect.right
}

export function setUpScrollbars() {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return
  document.addEventListener(
    'scroll',
    (e) => show(e.target === document ? document.documentElement : (e.target as Element)),
    true,
  )
  document.addEventListener('mousemove', (e) => {
    const target = e.target as Element
    const now = target instanceof Element && onScrollbar(target, e.clientX) ? target : null
    if (now === hovered) return
    const left = hovered
    hovered = now
    if (now) show(now)
    if (left) show(left) // fades out after the delay
  })
}
