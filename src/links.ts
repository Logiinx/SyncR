import { Extension } from '@tiptap/react'
import { Plugin } from '@tiptap/pm/state'
import { isTauri } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { followNoteLink, linkTargetTitle, parseNoteLink } from './noteLinks'
import { hoverCard } from './linkPreviews'
import { currentZoom } from './appearance'

// Only web and e-mail links are opened (not e.g. "javascript:" or local files)
const SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:']

// Opens a link in the normal web browser: through Windows in the desktop app,
// in a new tab (or the phone's browser) otherwise.
export function openLink(href: string) {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return
  }
  if (!SAFE_PROTOCOLS.includes(url.protocol)) return
  if (isTauri()) openUrl(url.href).catch((error) => console.error(error))
  else window.open(url.href, '_blank', 'noopener,noreferrer')
}

// "https://www.example.com/" and "example.com" count as the same address
export function simplify(address: string) {
  return address
    .trim()
    .toLowerCase()
    .replace(/^(https?:\/\/|mailto:)/, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
}

// Hovering a link with the mouse shows its hover card (linkPreviews.ts), or else its address,
// unless the link text already is the address. Also on link cards (their address: data-href).
function linkTooltip() {
  const tooltip = document.createElement('div')
  tooltip.className = 'link-tooltip'
  document.body.append(tooltip)
  let timer: number | undefined
  let shownFor: HTMLElement | undefined

  const hide = () => {
    clearTimeout(timer)
    shownFor = undefined
    tooltip.classList.remove('visible')
  }
  // Below the link, or above it when there's no room (a large card). Screen pixels ÷ the app's
  // scale (CSS zoom).
  const place = () => {
    if (!shownFor) return
    const zoom = currentZoom()
    const box = shownFor.getBoundingClientRect()
    const [width, height] = [window.innerWidth / zoom, window.innerHeight / zoom]
    const [left, top, bottom] = [box.left / zoom, box.top / zoom, box.bottom / zoom]
    tooltip.style.left = `${Math.max(4, Math.min(left, width - tooltip.offsetWidth - 4))}px`
    const below = bottom + 6
    const above = top - 6 - tooltip.offsetHeight
    tooltip.style.top = `${below + tooltip.offsetHeight > height - 4 && above > 4 ? above : below}px`
  }
  // A picture arriving makes the card taller
  tooltip.addEventListener('load', place, true)

  const show = (link: HTMLElement) => {
    const onCard = link.classList.contains('link-card')
    const href = (onCard ? link.dataset.href : link.getAttribute('href')) ?? ''
    if (!href || link === shownFor) return
    clearTimeout(timer)
    timer = window.setTimeout(() => {
      const card = parseNoteLink(href) ? null : hoverCard(href, onCard)
      if (card) {
        tooltip.replaceChildren(card)
      } else {
        if (onCard || simplify(href) === simplify(link.textContent ?? '')) return
        // Links to notes: the note's title instead of the syncr:note/… address
        tooltip.textContent = parseNoteLink(href) ? `→ ${linkTargetTitle(href) ?? 'Note not found'}` : href
      }
      tooltip.classList.toggle('has-card', !!card)
      shownFor = link
      place()
      tooltip.classList.add('visible')
    }, 300)
  }
  return { show, hide, destroy: () => (hide(), tooltip.remove()) }
}

// A click (tap) on a link in a note opens it. To edit a link's text, move the cursor
// into it with the arrow keys. (Pasting links: built into the editor's Link extension.)
export const OpenLinksOnClick = Extension.create({
  name: 'openLinksOnClick',

  addProseMirrorPlugins() {
    let tooltip: ReturnType<typeof linkTooltip> | undefined
    return [
      new Plugin({
        view: () => {
          tooltip = linkTooltip()
          return { destroy: () => tooltip?.destroy() }
        },
        props: {
          handleDOMEvents: {
            mouseover: (_view, event) => {
              // Only with a real mouse: phones fake a mouseover on tap
              if (!matchMedia('(hover: hover)').matches) return false
              const link = (event.target as HTMLElement).closest<HTMLElement>('a[href], .link-card')
              if (link) tooltip?.show(link)
              else tooltip?.hide()
              return false
            },
            mouseout: (_view, event) => {
              // Moving between the parts of one link (bold text, a card's title…) isn't leaving it
              const from = (event.target as HTMLElement).closest('a[href], .link-card')
              if (!from?.contains(event.relatedTarget as Node | null)) tooltip?.hide()
              return false
            },
            mousedown: () => (tooltip?.hide(), false),
            // handleClick below opens the link, but it runs on mouseup: its preventDefault
            // doesn't stop the browser's own click on the <a> (target="_blank"), which opened
            // the link a second time. Block that one here.
            click: (_view, event) => {
              if ((event.target as HTMLElement).closest('a[href]')) event.preventDefault()
              return false
            },
            keydown: () => (tooltip?.hide(), false),
            wheel: () => (tooltip?.hide(), false),
          },
          handleClick: (_view, _pos, event) => {
            if (event.button !== 0) return false
            const link = (event.target as HTMLElement).closest('a[href]')
            if (!link) return false
            event.preventDefault()
            const href = link.getAttribute('href')!
            if (parseNoteLink(href)) followNoteLink(href)
            else openLink(href)
            return true
          },
        },
      }),
    ]
  },
})
