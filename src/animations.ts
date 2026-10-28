// Opening and closing animations. Opening ones are plain CSS (index.css, "Opening and closing
// animations"). Closing: React removes a closed window at once, so a watcher puts the removed
// element back for a moment, plays its closing animation, then removes it. It no longer belongs
// to React, and nothing in it can be clicked (inert).

import { useLayoutEffect, useRef } from 'react'

export const CLOSE_MS = 130
const OPEN_MS = 200
const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)' // starts slowly, ends fast: things leaving
const EASE_OUT = 'cubic-bezier(0.2, 0, 0, 1)' // starts fast, slows down: things arriving

// Settings → Animations (see appearance.ts)
export function animationsOn() {
  return !document.documentElement.classList.contains('no-animations')
}

// A menu folds up from the bottom (its shadow, up to 24px around, stays visible)
const FOLD = [{ clipPath: 'inset(-24px)' }, { clipPath: 'inset(0 -24px 100% -24px)' }]

function play(el: Element | null, keyframes: Keyframe[]) {
  return el?.animate(keyframes, { duration: CLOSE_MS, easing: EASE_IN, fill: 'forwards' })
}

// Collapsible things (note sections, Board groups and cards) grow open and shrink shut, from or
// to their natural height ("auto" can be animated thanks to interpolate-size, index.css :root).
// overflow: hidden also keeps their content's own margins inside, so nothing jumps at the end.
function heightFrames(el: Element, display?: string): Keyframe[] {
  const { marginTop, marginBottom } = getComputedStyle(el)
  const shut = { height: '0px', marginTop: '0px', marginBottom: '0px', overflow: 'hidden', display }
  const open = { height: 'auto', marginTop, marginBottom, overflow: 'hidden', display }
  return [shut, open]
}

export function growOpen(el: Element | null | undefined) {
  if (!el || !animationsOn()) return
  el.animate(heightFrames(el), { duration: OPEN_MS, easing: EASE_OUT })
}

// For something just hidden (display: none): shown again while it shrinks
export function shrinkShut(el: Element | null | undefined, display = 'block') {
  if (!el || !animationsOn()) return
  el.animate(heightFrames(el, display).reverse(), { duration: CLOSE_MS, easing: EASE_IN })
}

// A Board card or group folding (not on its first render): grow open or shrink shut. A group's
// cards are removed when it folds: its click calls closeCopy() to shrink them.
export function useFoldAnimation(folded: boolean, content: () => Element | null | undefined) {
  const last = useRef(folded)
  useLayoutEffect(() => {
    if (last.current === folded) return
    last.current = folded
    if (folded) shrinkShut(content())
    else growOpen(content())
  }, [folded])
}

// What gets a closing animation, and which one
const EXITS: [string, (el: HTMLElement) => (Animation | undefined)[]][] = [
  // Windows and the image viewer: the dark background fades, the window sinks 8px
  [
    '.dialog-backdrop, .image-viewer',
    (el) => [
      play(el, [{ opacity: 1 }, { opacity: 0 }]),
      play(el.firstElementChild, [{ transform: 'none' }, { transform: 'translateY(8px)' }]),
    ],
  ],
  // Menus: right-click and "▾" menus, the phone's "⋯" list, table menu (all in a .menu-backdrop),
  // the text colors. The slash menu and the note picker: COPY_EXITS.
  ['.menu-backdrop', (el) => [play(el.firstElementChild, FOLD)]],
  ['.color-popover', (el) => [play(el, FOLD)]],
  // Side panels (index.css): PC: the Board slides out to the right and the page takes the room
  // back (the sidebar to the left). Phone: they slide out over the page, the shade fades.
  [
    '.board, .sidebar',
    (el) => {
      const right = el.matches('.board')
      if (matchMedia('(max-width: 699px)').matches) {
        return [play(el, [{ transform: 'none' }, { transform: `translateX(${right ? 100 : -100}%)` }])]
      }
      const margin = right ? 'marginRight' : 'marginLeft'
      return [play(el, [{ [margin]: '0px' }, { [margin]: `${-el.offsetWidth}px` }])]
    },
  ],
  ['.backdrop', (el) => [play(el, [{ opacity: 1 }, { opacity: 0 }])]],
  // Due reminder cards (and "N reminders · Done all"): back out past the window's right edge;
  // the last one leaves with its box
  [
    '.reminder-alert, .reminder-alerts-head',
    (el) => [play(el, [{ transform: 'none' }, { transform: 'translateX(calc(100% + 16px))' }])],
  ],
  ['.reminder-alerts', (el) => [play(el, [{ transform: 'none' }, { transform: 'translateX(100%)' }])]],
]

// What gets emptied as it's removed, so the watcher would animate an empty box: closeCopy()
// animates a copy instead, made just before closing
const COPY_EXITS: typeof EXITS = [
  // The slash menu and the note picker (Tiptap empties them first)
  ['.slash-menu-popup', (el) => [play(el.firstElementChild, FOLD)]],
  // A Board group's cards, when it folds (their text editors are taken out)
  ['.card-group-cards', (el) => [play(el, heightFrames(el).reverse())]],
]

const SECTION_CONTENT = '[data-type="detailsContent"]'
const born = new WeakMap<Element, number>() // when each section's content was created

// Started once (main.tsx)
export function startClosingAnimations() {
  new MutationObserver((records) => {
    if (!animationsOn()) return
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue
        if (node.matches(SECTION_CONTENT)) born.set(node, performance.now())
        node.querySelectorAll(SECTION_CONTENT).forEach((el) => born.set(el, performance.now()))
      }
      for (const node of record.removedNodes) {
        if (!(node instanceof HTMLElement) || node.classList.contains('closing')) continue
        const exit = EXITS.find(([selector]) => node.matches(selector))
        const parent = record.target
        if (!exit || !parent.isConnected) continue
        const next = record.nextSibling?.parentNode === parent ? record.nextSibling : null
        animateOut(node, parent, next, exit[1])
      }
    }
  }).observe(document.body, { childList: true, subtree: true })

  // Note sections (Tiptap Details): opening or closing one switches its content's "hidden".
  // Not for a section just created (a section dragged elsewhere is re-created, then reopened).
  new MutationObserver((records) => {
    if (!animationsOn()) return
    const changed = new Set(records.map((record) => record.target as HTMLElement))
    for (const el of changed) {
      if (!el.matches(SECTION_CONTENT) || performance.now() - (born.get(el) ?? 0) < 300) continue
      if (el.hidden) shrinkShut(el)
      else growOpen(el)
    }
  }).observe(document.body, { attributes: true, attributeFilter: ['hidden'], subtree: true })
}

function animateOut(node: HTMLElement, parent: Node, next: Node | null, exit: (el: HTMLElement) => (Animation | undefined)[]) {
  node.classList.add('closing')
  node.inert = true
  parent.insertBefore(node, next)
  Promise.all(exit(node).map((animation) => animation?.finished)).finally(() => node.remove())
}

// For COPY_EXITS: call just before closing it; a copy plays the closing animation in its place
// and the real one is hidden until it's removed
export function closeCopy(el: HTMLElement | null | undefined) {
  const exit = el && COPY_EXITS.find(([selector]) => el.matches(selector))
  if (!el || !exit || !el.parentNode || !animationsOn()) return
  const copy = el.cloneNode(true) as HTMLElement
  el.classList.add('closing')
  el.style.display = 'none'
  animateOut(copy, el.parentNode, el, exit[1])
}
