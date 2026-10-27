// Opening and closing animations. Opening ones are plain CSS (index.css, "Opening and closing
// animations"). Closing: React removes a closed window at once, so a watcher puts the removed
// element back for a moment, plays its closing animation, then removes it. It no longer belongs
// to React, and nothing in it can be clicked (inert).

export const CLOSE_MS = 130
const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)' // starts slowly, ends fast: things leaving

// Settings → Animations (see appearance.ts)
export function animationsOn() {
  return !document.documentElement.classList.contains('no-animations')
}

// A menu folds up from the bottom (its shadow, up to 24px around, stays visible)
const FOLD = [{ clipPath: 'inset(-24px)' }, { clipPath: 'inset(0 -24px 100% -24px)' }]

function play(el: Element | null, keyframes: Keyframe[]) {
  return el?.animate(keyframes, { duration: CLOSE_MS, easing: EASE_IN, fill: 'forwards' })
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
  // the text colors. The slash menu and the note picker: see closeCopy().
  ['.menu-backdrop, .slash-menu-popup', (el) => [play(el.firstElementChild, FOLD)]],
  ['.color-popover', (el) => [play(el, FOLD)]],
]

// Started once (main.tsx)
export function startClosingAnimations() {
  new MutationObserver((records) => {
    if (!animationsOn()) return
    for (const record of records) {
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
}

function animateOut(node: HTMLElement, parent: Node, next: Node | null, exit: (el: HTMLElement) => (Animation | undefined)[]) {
  node.classList.add('closing')
  node.inert = true
  parent.insertBefore(node, next)
  Promise.all(exit(node).map((animation) => animation?.finished)).finally(() => node.remove())
}

// For what gets emptied before it's removed (the slash menu and note picker: their content goes
// first): call just before closing it; a copy plays the closing animation in its place.
export function closeCopy(el: HTMLElement) {
  const exit = EXITS.find(([selector]) => el.matches(selector))
  if (!exit || !el.parentNode || !animationsOn()) return
  const copy = el.cloneNode(true) as HTMLElement
  el.classList.add('closing') // the watcher leaves the emptied one alone
  animateOut(copy, el.parentNode, el, exit[1])
}
