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
        node.classList.add('closing')
        node.inert = true
        const next = record.nextSibling?.parentNode === parent ? record.nextSibling : null
        parent.insertBefore(node, next)
        Promise.all(exit[1](node).map((animation) => animation?.finished)).finally(() => node.remove())
      }
    }
  }).observe(document.body, { childList: true, subtree: true })
}
