import { isTauri } from '@tauri-apps/api/core'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { finalSync } from './autoSync'

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

// Last sync first (max 5 s): the installer closes the app.
export async function installUpdate(update: Update) {
  await finalSync()
  await update.downloadAndInstall()
  await relaunch()
}
