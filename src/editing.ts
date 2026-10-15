import { read, write } from './localState'

// How typing behaves on this device (Settings dialog). Stored per device, never synced.

export interface Editing {
  smartTypography: boolean // "--" → —, "->" → →, curly quotes, … (typography.ts)
}

const KEY = 'syncr.editing'
const DEFAULTS: Editing = { smartTypography: false }

export function loadEditing(): Editing {
  return { ...DEFAULTS, ...read<Partial<Editing>>(KEY, {}) }
}

export function saveEditing(editing: Editing) {
  write(KEY, editing)
}
