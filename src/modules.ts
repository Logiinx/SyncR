import { useSyncExternalStore } from 'react'
import { read, write } from './localState'

// Mail, Video and Games can be turned off (the switch at the top of each one's Settings section):
// the tab closes and can't be opened, and its background work stops. Back on: as before. This
// device only; on until turned off. Followed in every window (the pop-up too) through "storage".
export type Module = 'mail' | 'video' | 'games'

const KEY = 'syncr.modulesOff'
let off = read<Module[]>(KEY, [])
const listeners = new Set<() => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return
    off = read<Module[]>(KEY, [])
    listeners.forEach((listener) => listener())
  })
}

export const moduleOn = (module: Module) => !off.includes(module)

export function setModuleOn(module: Module, on: boolean) {
  off = [...off.filter((m) => m !== module), ...(on ? [] : [module])]
  write(KEY, off)
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useModuleOn(module: Module) {
  return useSyncExternalStore(subscribe, () => moduleOn(module))
}
