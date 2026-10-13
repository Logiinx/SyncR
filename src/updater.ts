import { isTauri } from '@tauri-apps/api/core'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

// Asks GitHub Releases if a newer version exists.
// Returns null in the browser/phone version, or if the check fails (e.g. offline).
export async function findUpdate(): Promise<Update | null> {
  if (!isTauri()) return null
  try {
    return await check()
  } catch (error) {
    console.warn('Update check failed:', error)
    return null
  }
}

// TODO (sync step): run a final sync before installing.
export async function installUpdate(update: Update) {
  await update.downloadAndInstall()
  await relaunch()
}
