import { useEffect, useRef, useState, type RefObject } from 'react'

// The phone's Back gesture (and a mouse's back button on the PC) closes what's open, newest
// first: a menu, a window, a step inside a window (‹ Back), the image viewer, a phone side panel.
// Nothing open: Back leaves the app as usual (user, 2026-11-23).
// How: each open thing has an invisible history step (pushState); Back moves one step back and
// fires popstate, then the newest thing closes. Closed another way (✕, a click outside), its step
// goes too. Steps are numbered by their place (`syncrBack`), and only one history move runs at a
// time (several history.back() at once can pile up and close the wrong thing): settle() brings the
// steps in line with what's open, reusing a step when one thing closes as another opens.

interface Entry {
  onBack: () => void
  el?: Element | null // the thing on screen: a step inside it goes first (see pushBack)
}

const stack: Entry[] = [] // what's open, newest last
const depthOf = (state: unknown) => {
  const depth = (state as { syncrBack?: number } | null)?.syncrBack
  return typeof depth === 'number' ? depth : 0
}
let position = depthOf(history.state) // our steps up to the current one (left over after a reload)
let moving = false // a history.go() of ours is on its way (its popstate isn't a Back)
let settleQueued = false

function settle() {
  settleQueued = false
  if (moving) return // again once it lands
  if (position > stack.length) {
    moving = true
    history.go(stack.length - position)
  }
  while (position < stack.length) history.pushState({ syncrBack: ++position }, '')
}

function settleSoon() {
  if (settleQueued) return
  settleQueued = true
  queueMicrotask(settle)
}

// Adds an open thing. Returns its removal, for when it closes another way.
export function pushBack(onBack: () => void, el?: Element | null) {
  const entry: Entry = { onBack, el }
  // A window and the ‹ Back inside it can appear together, and React starts the inner one first:
  // the outer one goes below anything it contains, so Back takes the inner step first
  const inside = el ? stack.findIndex((other) => other.el && el.contains(other.el)) : -1
  if (inside >= 0) stack.splice(inside, 0, entry)
  else stack.push(entry)
  if (!moving && position < stack.length) history.pushState({ syncrBack: ++position }, '')
  return () => {
    const i = stack.indexOf(entry)
    if (i < 0) return // closed by Back: its step is gone already
    stack.splice(i, 1)
    settleSoon()
  }
}

window.addEventListener('popstate', (event) => {
  position = depthOf(event.state)
  if (moving) moving = false
  // Back: close the newest things until as many are open as there are steps
  else while (stack.length > position) stack.pop()!.onBack()
  settle()
})

// Steps left over from before a reload, nothing open for them: skip them now
settle()

// While `active`, Back calls onBack (usually the thing's own close). `el`: the thing on screen,
// so a ‹ Back inside a window goes before the window (pushBack). Still open after onBack (it only
// went back one level, e.g. a menu's in-place list): a new step, for the next Back.
export function useBack(onBack: () => void, active = true, el?: RefObject<Element | null>) {
  const latest = useRef(onBack)
  const [round, setRound] = useState(0)
  useEffect(() => {
    latest.current = onBack
  })
  useEffect(() => {
    if (!active) return
    return pushBack(() => {
      latest.current()
      setRound((n) => n + 1) // nothing if it closed (unmounted or no longer active)
    }, el?.current)
  }, [active, el, round])
}
