import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { RefreshCw, Settings, Trash2 } from 'lucide-react'
import CloseButton from './CloseButton'
import Dialog from './Dialog'
import Window from './Window'
import { t } from './i18n'

// As video_extensions.rs sends them
type ExtensionRow = {
  folder: string
  name: string
  version: string
  icon: string | null
  enabled: boolean
  has_settings: boolean
  error: string | null
}

function problemText(problem: unknown): string {
  const text = String(problem)
  if (text === 'no-manifest') return t('This folder has no manifest.json at its top. For a Chrome or Brave extension, choose the version folder inside it.')
  if (text === 'other-extension') return t('This folder holds a different extension.')
  if (text === 'not-loaded') return t('This extension couldn’t be loaded. It may be damaged, or made for another browser.')
  if (text === 'in-use') return t('The extension is busy. Close the video window and try again.')
  return t('That didn’t work: {why}', { why: text })
}

// The video window's extensions (Settings). Their files and everything else: video_extensions.rs
export default function VideoExtensions({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<ExtensionRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState<ExtensionRow | null>(null)
  const boxRef = useRef<HTMLElement>(null)

  // One thing at a time; the list is read again after each, also if it failed
  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (problem) {
      setError(problemText(problem))
    }
    try {
      setRows(await invoke<ExtensionRow[]>('video_extensions_list'))
    } catch (problem) {
      setError(problemText(problem))
      setRows((shown) => shown ?? [])
    }
    setBusy(false)
  }

  useEffect(() => {
    void run(async () => {})
    return () => void invoke('video_extensions_done')
  }, [])

  // The focus has to be inside the window for Escape to close it, also after a window on top closed
  useEffect(() => {
    if (!removing) boxRef.current?.focus()
  }, [removing])

  const pick = (folder?: string) =>
    run(() => invoke('video_extension_add', { title: t('Choose the extension’s folder'), folder }))

  return (
    <>
      <Window className="dialog video-follows" label={t('Video extensions')} onClose={onClose} ref={boxRef}>
        <div className="dialog-head">
          <h2>{t('Video extensions')}</h2>
          <CloseButton onClick={onClose} />
        </div>
        <p className="video-extensions-about">{t('They only run in the video window and can’t reach your notes. Nothing updates by itself.')}</p>
        {rows?.length === 0 && <p>{t('No extensions yet')}</p>}
        <ul className="video-follow-list">
          {rows?.map((row) => (
            <li key={row.folder} className="video-follow-row">
              {row.icon ? <img className="video-extension-icon" src={row.icon} alt="" /> : <span className="video-extension-icon" />}
              <span className="video-follow-text">
                <span className="video-follow-name" title={row.name}>{row.name}</span>
                {row.error ? (
                  <span className="video-follow-summary video-extension-failed" title={row.error}>{t('Didn’t load: {why}', { why: row.error })}</span>
                ) : (
                  <span className="video-follow-summary">{row.version}</span>
                )}
              </span>
              <input
                type="checkbox"
                checked={row.enabled}
                disabled={busy || !!row.error}
                title={row.enabled ? t('On') : t('Off')}
                aria-label={row.name}
                onChange={(event) => {
                  const on = event.target.checked
                  void run(() => invoke('video_extension_enable', { folder: row.folder, on }))
                }}
              />
              <button
                disabled={busy || !row.has_settings || !!row.error}
                title={row.has_settings ? t('Settings') : t('This extension has no settings page')}
                onClick={() => void run(() => invoke('video_extension_settings', { folder: row.folder }))}
              >
                <Settings size={15} />
              </button>
              <button disabled={busy} title={t('Update from a folder')} onClick={() => void pick(row.folder)}>
                <RefreshCw size={15} />
              </button>
              <button disabled={busy} title={t('Remove')} onClick={() => setRemoving(row)}>
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
        {error && <p className="event-error">{error}</p>}
        <div className="video-extensions-foot">
          <button className="setting-button" disabled={busy} onClick={() => void pick()}>
            {t('Add from a folder…')}
          </button>
        </div>
      </Window>
      {removing && (
        <Dialog
          request={{
            title: t('Remove {name}?', { name: removing.name }),
            message: t('Its settings are deleted too.'),
            confirmLabel: t('Remove'),
            danger: true,
            onConfirm: () => void run(() => invoke('video_extension_remove', { folder: removing.folder })),
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </>
  )
}
