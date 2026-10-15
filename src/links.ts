import { Extension } from '@tiptap/react'
import { Plugin } from '@tiptap/pm/state'
import { isTauri } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'

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
function simplify(address: string) {
  return address
    .trim()
    .toLowerCase()
    .replace(/^(https?:\/\/|mailto:)/, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
}

// Hovering a link with the mouse shows its address, unless the link text already is the address
function linkTooltip() {
  const tooltip = document.createElement('div')
  tooltip.className = 'link-tooltip'
  document.body.append(tooltip)
  let timer: number | undefined

  const hide = () => {
    clearTimeout(timer)
    tooltip.classList.remove('visible')
  }
  const show = (link: HTMLElement) => {
    const href = link.getAttribute('href')!
    if (simplify(href) === simplify(link.textContent ?? '')) return
    clearTimeout(timer)
    timer = window.setTimeout(() => {
      tooltip.textContent = href
      const box = link.getBoundingClientRect()
      tooltip.style.left = `${Math.max(4, Math.min(box.left, window.innerWidth - tooltip.offsetWidth - 4))}px`
      tooltip.style.top = `${box.bottom + 6}px`
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
              const link = (event.target as HTMLElement).closest<HTMLElement>('a[href]')
              if (link) tooltip?.show(link)
              else tooltip?.hide()
              return false
            },
            mouseout: () => (tooltip?.hide(), false),
            mousedown: () => (tooltip?.hide(), false),
            keydown: () => (tooltip?.hide(), false),
            wheel: () => (tooltip?.hide(), false),
          },
          handleClick: (_view, _pos, event) => {
            if (event.button !== 0) return false
            const link = (event.target as HTMLElement).closest('a[href]')
            if (!link) return false
            event.preventDefault()
            openLink(link.getAttribute('href')!)
            return true
          },
        },
      }),
    ]
  },
})
