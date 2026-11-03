import { isTauri } from '@tauri-apps/api/core'

// Which kind of device this is, shown with conflict copies and note history versions
export function deviceName() {
  if (isTauri()) return 'PC'
  if (/Android|iPhone|iPad/i.test(navigator.userAgent)) return 'phone'
  return 'browser'
}
