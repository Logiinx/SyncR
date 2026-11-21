// Opening Settings on one section from elsewhere: a module's ⚙️ (Video, Games), the Hardware
// widget's menu, the taskbar battery ('mouse-battery': Hardware, scrolled to it). App.tsx listens.
export type SettingsStart = 'video' | 'games' | 'hardware' | 'mouse-battery'

export function openSettings(start: SettingsStart) {
  window.dispatchEvent(new CustomEvent<SettingsStart>('open-settings', { detail: start }))
}

export function listenOpenSettings(open: (start: SettingsStart) => void) {
  const listener = (event: Event) => open((event as CustomEvent<SettingsStart>).detail)
  window.addEventListener('open-settings', listener)
  return () => window.removeEventListener('open-settings', listener)
}
