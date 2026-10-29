// Opening and closing animations. Opening ones are plain CSS (index.css, "Opening and closing
// animations"). Closing: React removes a closed window at once, so a watcher puts the removed
// element back for a moment, plays its closing animation, then removes it. It no longer belongs
// to React, and nothing in it can be clicked (inert).

import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { currentZoom } from './appearance'

// The app's timings, all in one place (picked by the user, DECISIONS.md "Wish list"): big things
// (windows, side panels, reminder cards, the sync message) and small ones (menus, sections, items
// in lists, tab lines). Closing ≈ 70% of opening. Also CSS variables for index.css (--open-big…).
export const TIMING = {
  openBig: 400,
  closeBig: 280,
  openSmall: 240,
  closeSmall: 170,
  openPhone: 340, // side panels on the phone: a bit quicker
  closePhone: 240,
}
const EASE_OPEN = 'cubic-bezier(0.32, 0.72, 0, 1)' // gentle start, smooth stop: things arriving
const EASE_CLOSE = 'cubic-bezier(0.4, 0, 0.6, 0.6)' // things leaving
// Windows come from (and go back to) a bit lower and smaller: they "settle in"
const SETTLE = 'translateY(8px) scale(0.94)'

const root = document.documentElement.style
for (const [name, ms] of Object.entries(TIMING)) root.setProperty(`--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, `${ms}ms`)
root.setProperty('--ease-open', EASE_OPEN)
root.setProperty('--ease-close', EASE_CLOSE)
root.setProperty('--settle', SETTLE)

// Settings → Animations (see appearance.ts)
export function animationsOn() {
  return !document.documentElement.classList.contains('no-animations')
}

// Side panels: "slide-in" when opened after the app started (index.css). Decided once, when
// the panel appears: a panel already open at start never gets the slide. (Adding the class later,
// or switching the animation on with .ready, would start the slide right then.)
export function useSlideIn() {
  const [later] = useState(() => document.documentElement.classList.contains('ready'))
  return later ? ' slide-in' : ''
}

// A menu folds up from the bottom (its shadow, up to 24px around, stays visible)
const FOLD = [{ clipPath: 'inset(-24px)' }, { clipPath: 'inset(0 -24px 100% -24px)' }]

// A closing animation (big things by default)
function play(el: Element | null, keyframes: Keyframe[], duration = TIMING.closeBig) {
  return el?.animate(keyframes, { duration, easing: EASE_CLOSE, fill: 'forwards' })
}

// Collapsible things (note sections, Board groups and cards) grow open and shrink shut, from or
// to their natural height ("auto" can be animated thanks to interpolate-size, index.css :root).
// overflow: hidden also keeps their content's own margins inside, so nothing jumps at the end.
function heightFrames(el: Element, display?: string): Keyframe[] {
  const shut = { ...FLAT, marginTop: '0px', marginBottom: '0px', overflow: 'hidden', display }
  const open = { ...upright(el), overflow: 'hidden', display }
  return [shut, open]
}

// Its height with everything around it, flat (0) or as it is (padding and borders too: a
// height of 0 alone would still leave them)
const FLAT = { height: '0px', paddingTop: '0px', paddingBottom: '0px', borderTopWidth: '0px', borderBottomWidth: '0px' }

function upright(el: Element) {
  const style = getComputedStyle(el)
  const { marginTop, marginBottom, paddingTop, paddingBottom, borderTopWidth, borderBottomWidth } = style
  return { height: 'auto', marginTop, marginBottom, paddingTop, paddingBottom, borderTopWidth, borderBottomWidth }
}

export function growOpen(el: Element | null | undefined) {
  if (!el || !animationsOn()) return
  el.animate(heightFrames(el), { duration: TIMING.openSmall, easing: EASE_OPEN })
}

// For something just hidden (display: none): shown again while it shrinks
export function shrinkShut(el: Element | null | undefined, display = 'block') {
  if (!el || !animationsOn()) return
  el.animate(heightFrames(el, display).reverse(), { duration: TIMING.closeSmall, easing: EASE_CLOSE })
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

// Items of a list (Board cards and groups, games in My games). Added to a list already on screen:
// it grows in. Removed from a list that stays: a copy of it, made before React empties it (a
// card's text editor is taken out), shrinks and fades out, and the items after it close the gap.
// Neither when the whole list appears or goes (opening the Board, another games tab: a new list).
// In a grid (game covers): fade + scale instead, the other tiles glide to their new places.
const listSeen = new WeakMap<Element, number>() // when each list first showed an item

export function useListItem(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current
    const list = el?.parentElement
    if (!el || !list) return
    const seen = listSeen.get(list)
    if (seen === undefined) listSeen.set(list, performance.now())
    else if (performance.now() - seen > 300 && animationsOn()) {
      // Measured without a running one (React runs this twice in development)
      el.getAnimations().forEach((animation) => animation.cancel())
      el.animate(itemFrames(el, list), { duration: TIMING.openSmall, easing: EASE_OPEN })
    }
    return () => {
      if (!animationsOn()) return
      const copy = el.cloneNode(true) as HTMLElement
      const next = el.nextSibling
      queueMicrotask(() => {
        // Still there (React's test run in development), or its whole list went too
        if (el.isConnected || !list.isConnected) return
        itemOut(copy, list, next?.parentNode === list ? next : null)
      })
    }
  }, [])
}

// A list that can be empty (the Board, a group): known as on screen even before its first item
export function useList(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current
    if (el && !listSeen.has(el)) listSeen.set(el, performance.now())
  })
}

// Pages (a note, Games, Reminders, the empty page) crossfade when switching tabs: the new one
// fades in while a copy of the old one (made before React empties it), on top, fades out. Not
// when the app starts.
export function usePage(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current
    const body = el?.parentElement
    if (!el || !body) return
    if (document.documentElement.classList.contains('ready') && animationsOn()) {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: TIMING.openSmall, easing: EASE_OPEN })
    }
    return () => {
      if (!animationsOn()) return
      const copy = el.cloneNode(true) as HTMLElement
      const scroller = el.matches('.page') ? el : el.querySelector('.page')
      const scroll = scroller?.scrollTop ?? 0
      const place = { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight }
      const next = el.nextSibling
      queueMicrotask(() => {
        if (el.isConnected || !body.isConnected) return
        // Where it was, over the new page (.body is position: relative)
        Object.assign(copy.style, {
          position: 'absolute',
          left: `${place.left}px`,
          top: `${place.top}px`,
          width: `${place.width}px`,
          height: `${place.height}px`,
        })
        copy.classList.add('closing')
        copy.inert = true
        body.insertBefore(copy, next?.parentNode === body ? next : null)
        const copyScroller = copy.matches('.page') ? copy : copy.querySelector('.page')
        if (copyScroller) copyScroller.scrollTop = scroll
        copy
          .animate([{ opacity: 1 }, { opacity: 0 }], { duration: TIMING.closeSmall, easing: EASE_CLOSE, fill: 'forwards' })
          .finished.finally(() => copy.remove())
      })
    }
  }, [])
}

// The same for lists without their own item components (note tabs, the sidebar's notes, the
// Reminders list): items are found by their data-item attribute (unique key) inside `ref`. An
// item grows in when its list (its parent) was already showing items, and shrinks out when its
// list stays. reset: when it changes, the list changes all at once (a search, a filter): none.
interface Tracked {
  el: HTMLElement
  parent: HTMLElement | null
}

export function useListItems(ref: RefObject<HTMLElement | null>, reset?: unknown) {
  const last = useRef<{ items: Map<string, Tracked>; reset: unknown } | null>(null)
  useLayoutEffect(() => {
    const root = ref.current
    const items = new Map<string, Tracked>()
    root?.querySelectorAll<HTMLElement>('[data-item]').forEach((el) => {
      items.set(el.dataset.item!, { el, parent: el.parentElement })
    })
    const prev = last.current
    last.current = root ? { items, reset } : null
    if (!prev || !root || prev.reset !== reset || !animationsOn()) return

    const parents = new Set([...prev.items.values()].map((item) => item.parent))
    for (const [key, { el, parent }] of items) {
      if (!prev.items.has(key) && parent && (parents.has(parent) || parent === root)) {
        el.animate(itemFrames(el, parent), { duration: TIMING.openSmall, easing: EASE_OPEN })
      }
    }
    const order = [...prev.items.keys()]
    order.forEach((key, index) => {
      const { el, parent } = prev.items.get(key)!
      if (items.has(key) || el.isConnected || !parent?.isConnected) return
      // Back where it was: before the next item that's still in the same list
      const next = order
        .slice(index + 1)
        .map((after) => items.get(after)?.el)
        .find((after) => after?.parentElement === parent)
      itemOut(el, parent, next ?? null)
    })
  })
}

function isGrid(list: Element) {
  return getComputedStyle(list).display === 'grid'
}

// Gone ↔ there. In a column: its height, margins and the gap after it (the last gap goes with it).
// In a row (note tabs): the same with its width.
function itemFrames(el: Element, list: Element): Keyframe[] {
  if (isGrid(list)) return [{ opacity: 0, transform: 'scale(0.9)' }, { opacity: 1, transform: 'none' }]
  const listStyle = getComputedStyle(list)
  if (listStyle.display.endsWith('flex') && !listStyle.flexDirection.startsWith('column')) {
    const gap = parseFloat(listStyle.columnGap) || 0
    const style = getComputedStyle(el)
    const sides = ['minWidth', 'paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth', 'marginLeft'] as const
    const gone: Keyframe = { width: '0px', marginRight: `${-gap}px`, opacity: 0, overflow: 'hidden' }
    const there: Keyframe = { width: 'auto', marginRight: style.marginRight, opacity: 1, overflow: 'hidden' }
    for (const side of sides) {
      gone[side] = '0px'
      there[side] = style[side]
    }
    return [gone, there]
  }
  const gap = parseFloat(getComputedStyle(list).rowGap) || 0
  const gone = { ...FLAT, marginTop: '0px', marginBottom: `${-gap}px`, opacity: 0, transform: 'scale(0.96)' }
  const there = { ...upright(el), opacity: 1, transform: 'none' }
  return [{ ...gone, overflow: 'hidden' }, { ...there, overflow: 'hidden' }]
}

function itemOut(copy: HTMLElement, list: Element, next: Node | null) {
  // Not found as the item itself (it has the same ids)
  for (const el of [copy, ...copy.querySelectorAll('[data-card-id], [data-line], [data-item]')]) {
    for (const name of ['data-card-id', 'data-line', 'data-item']) el.removeAttribute(name)
  }
  copy.classList.add('closing')
  copy.inert = true
  list.insertBefore(copy, next)
  const grid = isGrid(list)
  const animation = copy.animate(itemFrames(copy, list).reverse(), { duration: TIMING.closeSmall, easing: EASE_CLOSE, fill: 'forwards' })
  animation.finished.finally(() => {
    if (!grid) return copy.remove()
    // The other tiles glide from where they were to their new places
    const others = [...list.children].filter((child) => child !== copy)
    const before = others.map((child) => child.getBoundingClientRect())
    copy.remove()
    const zoom = currentZoom()
    others.forEach((child, i) => {
      const after = child.getBoundingClientRect()
      const dx = (before[i].left - after.left) / zoom
      const dy = (before[i].top - after.top) / zoom
      if (dx || dy) child.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: TIMING.openSmall, easing: EASE_OPEN })
    })
  })
}

// What gets a closing animation, and which one
const EXITS: [string, (el: HTMLElement) => (Animation | undefined)[]][] = [
  // Windows and the image viewer: the dark background fades, the window sinks 8px
  [
    '.dialog-backdrop, .image-viewer',
    (el) => [
      play(el, [{ opacity: 1 }, { opacity: 0 }]),
      play(el.firstElementChild, [{ transform: 'none' }, { transform: SETTLE }]),
    ],
  ],
  // Menus: right-click and "▾" menus, the phone's "⋯" list, table menu (all in a .menu-backdrop),
  // the text colors. The slash menu and the note picker: COPY_EXITS.
  ['.menu-backdrop', (el) => [play(el.firstElementChild, FOLD, TIMING.closeSmall)]],
  ['.color-popover', (el) => [play(el, FOLD, TIMING.closeSmall)]],
  // Side panels (index.css): the Board glides out to the right, the sidebar to the left. PC: it
  // keeps its room meanwhile, the page takes it back at the end. Phone: over the page, the shade
  // fades.
  [
    '.board, .sidebar',
    (el) => {
      const phone = matchMedia('(max-width: 699px)').matches
      const away = `translateX(${el.matches('.board') ? 100 : -100}%)`
      return [play(el, [{ transform: 'none' }, { transform: away }], phone ? TIMING.closePhone : TIMING.closeBig)]
    },
  ],
  ['.backdrop', (el) => [play(el, [{ opacity: 1 }, { opacity: 0 }], TIMING.closePhone)]],
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
  ['.slash-menu-popup', (el) => [play(el.firstElementChild, FOLD, TIMING.closeSmall)]],
  // A Board group's cards, when it folds (their text editors are taken out)
  ['.card-group-cards', (el) => [play(el, heightFrames(el).reverse(), TIMING.closeSmall)]],
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
