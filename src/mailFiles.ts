import { gmailApi } from './gmail'
import type { MailAlert, MailFile } from './mailAlerts'

// Attached files of an email (the row under it, MailReader.tsx): downloaded from Gmail only
// when opened or saved. Opening saves them to a temporary folder and opens them in their
// normal program; risky types (programs, scripts) can only be saved.

// Files that run something when opened: often how malware comes. Save… only.
const RISKY = /\.(exe|com|bat|cmd|msi|msix|msp|scr|pif|cpl|jar|js|jse|vbs|vbe|wsf|wsh|hta|ps1|psm1|lnk|reg|appx|appxbundle|application|gadget|iso|img|vhd|vhdx)$/i

export const isRisky = (file: MailFile) => RISKY.test(file.name.trim())

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

// The file's bytes, from the message or downloaded apart
export async function downloadFile(alert: MailAlert, file: MailFile): Promise<Uint8Array<ArrayBuffer>> {
  const data = file.data ??
    (await gmailApi(alert.account, `messages/${alert.id}/attachments/${file.attachmentId}`)).data as string
  return Uint8Array.from(atob(data.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
}

// Opened in its normal program. The browser version (development) downloads it instead.
export async function openFile(alert: MailAlert, file: MailFile) {
  if (isRisky(file)) return saveFile(alert, file)
  browserDownload(file, await downloadFile(alert, file))
}

// Saved where the user picks. The browser version (development): a normal download.
export async function saveFile(alert: MailAlert, file: MailFile) {
  browserDownload(file, await downloadFile(alert, file))
}

function browserDownload(file: MailFile, bytes: Uint8Array<ArrayBuffer>) {
  const url = URL.createObjectURL(new Blob([bytes], { type: file.type }))
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
