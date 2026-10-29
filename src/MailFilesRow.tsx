import { useState } from 'react'
import { Download, File, FileArchive, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, type LucideIcon } from 'lucide-react'
import { errorDetails, gmailErrorText } from './gmail'
import type { MailAlert, MailFile } from './mailAlerts'
import { fileSize, isRisky, openFile, saveFile } from './mailFiles'
import Spinner from './Spinner'

// The email's attached files (MailReader.tsx), between the email and its buttons: one chip per
// file (icon, name, size); a click opens it, ⬇ saves it. The first 3, then "+N more". A spinner
// while it downloads. Programs and scripts can only be saved (mailFiles.ts).

const FIRST = 3

function MailFilesRow({ alert, files }: { alert: MailAlert; files: MailFile[] }) {
  const [all, setAll] = useState(false)
  const [busy, setBusy] = useState<number[]>([]) // files downloading
  const [error, setError] = useState<{ text: string; details: string } | null>(null)
  if (!files.length) return null

  async function run(index: number, action: typeof openFile) {
    if (busy.includes(index)) return
    setBusy((list) => [...list, index])
    setError(null)
    try {
      await action(alert, files[index])
    } catch (e) {
      setError({ text: `${files[index].name}: ${gmailErrorText(e)}`, details: errorDetails(e) })
    }
    setBusy((list) => list.filter((i) => i !== index))
  }

  const shown = all ? files : files.slice(0, FIRST)
  return (
    <div className="mail-files">
      {shown.map((file, index) => {
        const Icon = fileIcon(file)
        const risky = isRisky(file)
        return (
          <div key={index} className="mail-file">
            <button
              className="mail-file-open"
              title={risky ? `${file.name}\nA program or script: it can only be saved` : `Open ${file.name}`}
              onClick={() => run(index, risky ? saveFile : openFile)}
            >
              {busy.includes(index) ? <Spinner size={14} /> : <Icon size={14} />}
              <span className="mail-file-name">{file.name}</span>
              <span className="mail-file-size">{fileSize(file.size)}</span>
            </button>
            <button className="mail-file-save" title="Save…" aria-label="Save…" onClick={() => run(index, saveFile)}>
              <Download size={14} />
            </button>
          </div>
        )
      })}
      {!all && files.length > FIRST && (
        <button className="mail-file-more" onClick={() => setAll(true)}>
          +{files.length - FIRST} more
        </button>
      )}
      {error && <span className="mail-files-error" title={error.details}>{error.text}</span>}
    </div>
  )
}

// An icon for the kind of file
function fileIcon(file: MailFile): LucideIcon {
  const name = file.name.toLowerCase()
  if (file.type.startsWith('image/')) return FileImage
  if (file.type.startsWith('video/')) return FileVideo
  if (file.type.startsWith('audio/')) return FileAudio
  if (/\.(zip|rar|7z|tar|gz|tgz)$/.test(name)) return FileArchive
  if (/\.(xlsx?|ods|csv)$/.test(name)) return FileSpreadsheet
  if (/\.(pdf|docx?|odt|rtf|txt|md)$/.test(name) || file.type.startsWith('text/')) return FileText
  return File
}

export default MailFilesRow
