import { useState } from 'react'
import { X } from 'lucide-react'
import Dialog from './Dialog'
import { ModuleSwitch, SettingRow } from './SettingsCard'
import { loadBackground } from './desktop'
import { t } from './i18n'
import { withIcon } from './richText'
import { type Room, type ShowAs, saveSpotify, useSpotify, useSpotifySong } from './spotify'

const SHOW_AS: [ShowAs, () => string][] = [
  ['strip', () => t('Taskbar strip')],
  ['widget', () => t('Floating widget')],
]

// ⏮ ⏭ on the strip: its right edge is held by the battery, so their room comes from the left
const ROOM: [Room, () => string][] = [
  ['grow', () => t('Strip grows')],
  ['keep', () => t('Room kept')],
]

// Settings → Spotify (spotify.ts): on or off, strip or widget, and what's playing now
export default function SpotifySection() {
  const settings = useSpotify()
  const song = useSpotifySong(settings.on)
  // Turning it on while ✕ quits SyncR warns once: the song only shows while SyncR runs
  const [quitWarning, setQuitWarning] = useState(false)
  function toggle(on: boolean) {
    const warn = on && !settings.warned && !loadBackground().closeToTray
    saveSpotify(warn ? { on, warned: true } : { on })
    if (warn) setQuitWarning(true)
  }

  return (
    <>
      <ModuleSwitch
        name={t('Spotify')}
        aboutLabel={t('About the Spotify module')}
        about={t('Shows the song the Spotify app is playing, in the taskbar or in a small widget on your desktop. Read from Windows, so no Spotify sign-in.')}
        on={settings.on}
        onChange={toggle}
      />
      <fieldset className="settings-part" disabled={!settings.on}>
        <SettingRow label={t('Show as')}>
          <select value={settings.showAs} onChange={(e) => saveSpotify({ showAs: e.target.value as ShowAs })}>
            {SHOW_AS.map(([id, name]) => (
              <option key={id} value={id}>
                {name()}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow label={t('Buttons on hover')} title={t('Strip grows: it widens to the left when the mouse comes over it. Room kept: their room is always there, so nothing moves.')}>
          <select value={settings.room} disabled={settings.showAs !== 'strip'} onChange={(e) => saveSpotify({ room: e.target.value as Room })}>
            {ROOM.map(([id, name]) => (
              <option key={id} value={id}>
                {name()}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow label={t('Now playing')}>
          {!settings.on ? (
            <span className="settings-status">—</span>
          ) : song === undefined ? (
            <span className="settings-status">…</span>
          ) : song === null ? (
            <span className="settings-status">{t('Nothing playing in Spotify')}</span>
          ) : (
            <span className={`spotify-now${song.playing ? '' : ' paused'}`} title={[song.title, song.artist, song.album].filter(Boolean).join('\n')}>
              {song.cover ? <img className="spotify-now-cover" src={song.cover} alt="" /> : <span className="spotify-now-cover" />}
              <span className="spotify-now-text">
                <span className="spotify-now-title">{song.title}</span>
                <span className="spotify-now-artist">{song.playing ? song.artist : song.artist ? t('Paused · {artist}', { artist: song.artist }) : t('Paused')}</span>
              </span>
            </span>
          )}
        </SettingRow>
      </fieldset>
      {quitWarning && (
        <Dialog
          request={{
            title: t('The song only shows while SyncR runs'),
            message: withIcon(t('{close} quits SyncR, and the song goes with it. To keep it, turn on “{close} hides SyncR in the tray” in Window.'), 'close', <X size={13} aria-label={t('Close')} />),
            confirmLabel: 'OK',
            noCancel: true,
            onConfirm: () => {},
          }}
          onClose={() => setQuitWarning(false)}
        />
      )}
    </>
  )
}
