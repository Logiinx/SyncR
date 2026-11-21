import { loadAppearance } from './appearance'

// A short sign that a sync worked (Settings → Appearance → Sync sign, per device): a line
// sweeping under the tabs, or a glow around the edge of the page, in the chosen color. Shown
// by autoSync.ts after a sync that sent or received changes, and after a click on the sync
// button. Never with animations off, nor while the app is hidden (nobody would see it).
export function playSyncSign() {
  const { syncSign, syncSignColor, animations } = loadAppearance()
  const area = document.querySelector('.body')
  if (syncSign === 'off' || !animations || !area || document.visibilityState === 'hidden') return
  // One at a time: a new one starts over
  area.querySelector(':scope > .sync-sign')?.remove()
  const sign = document.createElement('div')
  sign.className = `sync-sign ${syncSign}`
  sign.style.setProperty('--sign-color', `var(--text-${syncSignColor})`)
  sign.addEventListener('animationend', () => sign.remove())
  area.append(sign)
}
