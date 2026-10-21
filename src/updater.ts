import { isTauri } from '@tauri-apps/api/core'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { finalSync } from './autoSync'

// Asks GitHub Releases if a newer version exists (desktop app only).
// Throws if the check fails (e.g. offline). Returns null if there's nothing new.
export async function checkDesktopUpdate(): Promise<Update | null> {
  if (!isTauri()) return null
  return check()
}

// Same, but quietly: used at startup, where a failed check doesn't need a message.
export async function findUpdate(): Promise<Update | null> {
  try {
    return await checkDesktopUpdate()
  } catch (error) {
    console.warn('Update check failed:', error)
    return null
  }
}

// Last sync first (max 5 s): the installer closes the app.
// onProgress gets the downloaded part (0 to 1), or null if the size is unknown.
export async function installUpdate(update: Update, onProgress: (done: number | null) => void) {
  await finalSync()
  let total = 0
  let received = 0
  await update.downloadAndInstall((event) => {
    if (event.event === 'Started') total = event.data.contentLength ?? 0
    if (event.event === 'Progress') received += event.data.chunkLength
    onProgress(event.event === 'Finished' ? 1 : total ? Math.min(1, received / total) : null)
  })
  await relaunch()
}
