import { invoke, isTauri } from '@tauri-apps/api/core'
import { gmailApi } from './gmail'
import type { MailAlert, MailFile } from './mailAlerts'

// Attached files of an email (the row under it, MailReader.tsx): downloaded from Gmail only
// when opened or saved. Opening saves them to a temporary folder and opens them in their
// normal program; risky types (programs, scripts) can only be saved.

// Files that run something when opened: often how malware comes. Save… only. (The same list
// is in lib.rs, which refuses to open them too.)
const RISKY = /\.(exe|com|bat|cmd|msi|msix|msp|scr|pif|cpl|jar|js|jse|vbs|vbe|wsf|wsh|hta|ps1|psm1|lnk|reg|appx|appxbundle|application|gadget|iso|img|vhd|vhdx)$/i

// (Windows drops trailing dots and spaces: "x.exe." is a program too)
export const isRisky = (file: MailFile) => RISKY.test(file.name.trim().replace(/[. ]+$/, ''))

// 1234567 → "1.2 MB"
export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

// The file as Gmail gives it (base64url text), from the message or downloaded apart. The
// desktop app decodes it in Rust (lib.rs).
async function fileData(alert: MailAlert, file: MailFile): Promise<string> {
  return file.data ?? (await gmailApi(alert.account, `messages/${alert.id}/attachments/${file.attachmentId}`)).data
}

// Opened in its normal program (lib.rs, open_attachment). The browser version (development)
// downloads it instead.
export async function openFile(alert: MailAlert, file: MailFile) {
  if (isRisky(file)) return saveFile(alert, file)
  const data = await fileData(alert, file)
  if (isTauri()) await invoke('open_attachment', { name: file.name, data })
  else browserDownload(file, data)
}

// Saved where the user picks ("Save as" window, lib.rs). The browser version: a normal download.
export async function saveFile(alert: MailAlert, file: MailFile) {
  const data = await fileData(alert, file)
  if (isTauri()) await invoke('save_attachment', { name: file.name, data })
  else browserDownload(file, data)
}

function browserDownload(file: MailFile, data: string) {
  const bytes = Uint8Array.from(atob(data.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: file.type }))
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
