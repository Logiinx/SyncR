import { isTauri } from '@tauri-apps/api/core'

// PC: the window is a browser (WebView2), which has its own right-click menu (Back, Refresh,
// Save as, Print…) and shortcuts for them. Refresh restarts SyncR (PIN lock: locked again),
// so they're blocked. The menu stays in text boxes and on selected text (Cut, Copy, Paste);
// SyncR's own menus stop it themselves. The phone's browser is left alone.
export function blockBrowserMenu(target: Window | Document = window) {
  if (!isTauri()) return
  target.addEventListener('contextmenu', (e) => {
    if (!editable(e.target) && !hasSelection(e.target)) e.preventDefault()
  })
  target.addEventListener('keydown', (e) => {
    if (browserKey(e as KeyboardEvent)) e.preventDefault()
  }, true)
  // The mouse's back and forward buttons
  target.addEventListener('mouseup', (e) => {
    const button = (e as MouseEvent).button
    if (button === 3 || button === 4) e.preventDefault()
  }, true)
}

function browserKey(e: KeyboardEvent) {
  const key = e.key.toLowerCase()
  if (['f5', 'browserback', 'browserforward', 'browserrefresh'].includes(key)) return true
  if (e.altKey && (key === 'arrowleft' || key === 'arrowright')) return true
  return e.ctrlKey && !e.altKey && (key === 'r' || key === 'p')
}

function editable(target: EventTarget | null) {
  const el = target as HTMLElement | null
  if (!el?.closest) return false
  const input = el.closest('input, textarea, [contenteditable]') as HTMLElement | null
  if (!input) return false
  // By tag name: the mail frame's elements come from another page, instanceof fails there
  if (input.tagName === 'INPUT') return !['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset'].includes((input as HTMLInputElement).type) // i18n-ok
  return input.tagName === 'TEXTAREA' || input.isContentEditable
}

function hasSelection(target: EventTarget | null) {
  const doc = (target as Node | null)?.ownerDocument ?? document
  return !!doc.getSelection()?.toString()
}
