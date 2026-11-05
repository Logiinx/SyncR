import { invoke, isTauri } from '@tauri-apps/api/core'
import { decimal, t } from './i18n'
import { gmailApi } from './gmail'
import type { MailAlert, MailFile } from './mailAlerts'

// Attached files of an email (the row under it, MailReader.tsx): downloaded from Gmail only
// when opened or saved. Opening saves them to a temporary folder and opens them in their
// normal program; only common documents, pictures, audio and video, zip, invites and contact
// cards: anything else can only be saved.

// The kinds of files opened with a click. Others (programs, scripts, shortcuts, macro documents,
// types nobody thought of) are Save… only, often how malware comes. (The same list is in
// lib.rs, which refuses to open anything else too.)
const OPENABLE = /\.(pdf|txt|md|rtf|csv|docx|xlsx|pptx|odt|ods|odp|jpe?g|png|gif|webp|bmp|tiff?|heic|avif|mp3|m4a|aac|wav|flac|ogg|mp4|m4v|mov|webm|mkv|avi|zip|ics|vcf)$/i

// (Windows drops trailing dots and spaces: "x.exe." is a program)
export const canOpen = (file: MailFile) => OPENABLE.test(file.name.trim().replace(/[. ]+$/, ''))

// 1234567 → "1.2 MB"
export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} ${t('B')}`
  const units = [t('KB'), t('MB'), t('GB')]
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 ? decimal(value, 1) : Math.round(value)} ${units[unit]}`
}

// The file as Gmail gives it (base64url text), from the message or downloaded apart. The
// desktop app decodes it in Rust (lib.rs).
async function fileData(alert: MailAlert, file: MailFile): Promise<string> {
  return file.data ?? (await gmailApi(alert.account, `messages/${alert.id}/attachments/${file.attachmentId}`)).data
}

// Opened in its normal program (lib.rs, open_attachment). The browser version (development)
// downloads it instead.
export async function openFile(alert: MailAlert, file: MailFile) {
  if (!canOpen(file)) return saveFile(alert, file)
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
