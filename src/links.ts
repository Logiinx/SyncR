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

// A click (tap) on a link in a note opens it. To edit a link's text, move the cursor
// into it with the arrow keys. (Pasting links: built into the editor's Link extension.)
export const OpenLinksOnClick = Extension.create({
  name: 'openLinksOnClick',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
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
