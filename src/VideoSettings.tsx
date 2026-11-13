import { useEffect, useRef, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { ListVideo, Play, Puzzle, RefreshCw, Settings, Trash2 } from 'lucide-react'
import CloseButton from './CloseButton'
import Dialog from './Dialog'
import Window from './Window'
import { SettingRow, SettingsCard } from './SettingsCard'
import InfoTip from './InfoTip'
import { loadPlayerSettings, savePlayerSettings, SUBTITLE_LANGUAGES, YOUTUBE_QUALITIES, type PlayerSettings } from './videoPlayer'
import { t } from './i18n'
import { setAutoRewatch, setRewatchSection, useAutoRewatch, useRewatchSection } from './videoFolders'

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

// The Video tab's settings (its gear, or Settings → Video): the player, YouTube and the video
// window's extensions. The extensions' files and everything else: video_extensions.rs
export default function VideoSettings({ onClose }: { onClose: () => void }) {
  const [player, setPlayer] = useState(loadPlayerSettings)
  const rewatchSection = useRewatchSection()
  const autoRewatch = useAutoRewatch()
  function updatePlayer(change: Partial<PlayerSettings>) {
    savePlayerSettings(change)
    setPlayer(loadPlayerSettings())
  }
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

  // The extensions need the desktop app (Rust): in a browser, no Extensions card
  const extensions = isTauri()
  useEffect(() => {
    if (!extensions) return
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
      <Window className="dialog settings video-settings" label={t('Video settings')} onClose={onClose} ref={boxRef}>
        <div className="dialog-head">
          <h2>{t('Video settings')}</h2>
          <CloseButton onClick={onClose} />
        </div>
        <div className="settings-cards">
          <SettingsCard icon={ListVideo} title={t('List')}>
            <SettingRow label={t('Rewatch as a section in To watch')} title={t('At the bottom of To watch, instead of its own button between To watch and Watched')}>
              <input type="checkbox" checked={rewatchSection} onChange={(e) => setRewatchSection(e.target.checked)} />
            </SettingRow>
            <SettingRow
              label={t('Put finished playlists in Rewatch')}
              title={t('Those that don’t check for new videos once a day, unless they’re in one of your folders. Turning this off leaves them where they are.')}
            >
              <input type="checkbox" checked={autoRewatch} onChange={(e) => void setAutoRewatch(e.target.checked)} />
            </SettingRow>
          </SettingsCard>
          <SettingsCard icon={Play} title={t('Player')}>
            <SettingRow label={t('Mark as watched closes the video player')}>
              <input type="checkbox" checked={player.watchedCloses} onChange={(e) => updatePlayer({ watchedCloses: e.target.checked })} />
            </SettingRow>
            <SettingRow label={t('Close the video player when a video ends')} title={t('In a playlist, after its last video')}>
              <input type="checkbox" checked={player.endCloses} onChange={(e) => updatePlayer({ endCloses: e.target.checked })} />
            </SettingRow>
            <SettingRow
              label={
                <>
                  {t('Mark a video as watched near its end')}{' '}
                  <InfoTip label={t('About marking near the end')}>{t('With 2 minutes or 5% left, whichever is shorter. You can undo it on the player bar.')}</InfoTip>
                </>
              }
            >
              <input type="checkbox" checked={player.watchedNearEnd} onChange={(e) => updatePlayer({ watchedNearEnd: e.target.checked })} />
            </SettingRow>
            <SettingRow label={t('YouTube start quality')} title={t('Or the highest under it. The player can still change it for one video.')}>
              <select value={player.quality} onChange={(e) => updatePlayer({ quality: e.target.value as PlayerSettings['quality'] })}>
                {YOUTUBE_QUALITIES.map(([value, label]) => (
                  <option key={value} value={value}>{label || t('Auto')}</option>
                ))}
              </select>
            </SettingRow>
            <SettingRow label={t('YouTube subtitles')} title={t('Their language. On or off is remembered for each channel, with the button in the player.')}>
              <select
                value={player.subtitleLanguage}
                onChange={(e) => updatePlayer({ subtitleLanguage: e.target.value as PlayerSettings['subtitleLanguage'] })}
              >
                {SUBTITLE_LANGUAGES.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </SettingRow>
          </SettingsCard>
          {extensions && (
            <SettingsCard icon={Puzzle} title={t('Extensions')}>
              <p className="video-extensions-about">{t('They only run in the video window and can’t reach your notes. Nothing updates by itself.')}</p>
              {rows?.length === 0 && <p className="video-extensions-none">{t('No extensions yet')}</p>}
              <ul className="video-follow-list">
                {rows?.map((row) => (
                  <li key={row.folder} className="video-follow-row">
                    {row.icon ? <img className="video-extension-icon" src={row.icon} alt="" /> : <Puzzle className="video-extension-icon none" />}
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
            </SettingsCard>
          )}
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
