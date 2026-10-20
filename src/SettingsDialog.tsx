import { useEffect, useRef, useState } from 'react'
import { loadRuleGroups } from './colorRules'
import ColorRulesDialog from './ColorRulesDialog'
import { WhatsNewDialog, recentReleases } from './WhatsNew'
import { loadEditing, saveEditing, type Editing } from './editing'
import { isTauri } from '@tauri-apps/api/core'
import { playChime } from './chime'
import {
  connect as connectGoogle,
  connectedName as googleName,
  disconnect as disconnectGoogle,
  isConnected as isGoogleConnected,
} from './google'
import { igdb, isComplete, saveConnection, useConnection, type IgdbConnection } from './igdb'
import {
  loadBackground,
  saveBackground,
  setStartWithWindows,
  startsWithWindows,
  type Background,
} from './desktop'
import {
  DEFAULTS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  FONTS,
  loadAppearance,
  saveAppearance,
  SCALE_MAX,
  SCALE_MIN,
  type Appearance,
  type FontId,
} from './appearance'

// Settings. Changes are saved right away. Closed with Escape or a click outside it.
function SettingsDialog({ onClose }: { onClose: () => void }) {
  // Focused when it opens (so Escape works), without scrolling: it opens at the top
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => dialogRef.current?.focus({ preventScroll: true }), [])
  const [appearance, setAppearance] = useState(loadAppearance)
  function update(change: Partial<Appearance>) {
    // Start from the saved settings (always current), not from `appearance`, which may not
    // have caught up yet when two changes come quickly after each other
    const next = { ...loadAppearance(), ...change }
    setAppearance(next)
    saveAppearance(next)
  }

  const [editing, setEditing] = useState(loadEditing)
  function updateEditing(change: Partial<Editing>) {
    const next = { ...loadEditing(), ...change }
    setEditing(next)
    saveEditing(next)
  }

  const [background, setBackground] = useState(loadBackground)
  function updateBackground(change: Partial<Background>) {
    const next = { ...loadBackground(), ...change }
    setBackground(next)
    saveBackground(next)
  }

  // Read from Windows (null = not known yet). If changing it fails, show the real state again.
  const [autostart, setAutostart] = useState<boolean | null>(null)
  useEffect(() => {
    startsWithWindows().then(setAutostart, () => setAutostart(false))
  }, [])
  function toggleAutostart(on: boolean) {
    setAutostart(on)
    setStartWithWindows(on).catch((error) => {
      console.error(error)
      startsWithWindows().then(setAutostart)
    })
  }

  // The slider shows the new value while dragging; the app is scaled when it's released
  // (scaling while dragging would move the slider away under the finger).
  const [scale, setScale] = useState(appearance.scale)
  function applyScale() {
    if (scale !== appearance.scale) update({ scale })
  }

  // Color rules open in their own window (more room); back here when it closes
  const [showRules, setShowRules] = useState(false)
  const [rulesSummary, setRulesSummary] = useState('')
  useEffect(() => {
    if (showRules) return
    loadRuleGroups().then((groups) => {
      const on = groups.filter((g) => g.enabled).flatMap((g) => g.rules.filter((r) => r.enabled && r.words.trim()))
      setRulesSummary(groups.length === 0 ? 'None yet' : `${on.length} on`)
    })
  }, [showRules])

  // "What's new" also opens in place of Settings, like the color rules
  const [showWhatsNew, setShowWhatsNew] = useState(false)

  if (showRules) return <ColorRulesDialog onClose={() => setShowRules(false)} />
  if (showWhatsNew) return <WhatsNewDialog releases={recentReleases()} onClose={() => setShowWhatsNew(false)} />

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        className="dialog settings"
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-label="Settings"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2>Settings</h2>

        {/* Two columns on the PC, so everything shows without scrolling; one on the phone */}
        <div className="settings-columns">
          <div className="settings-column">
            <SectionTitle title="Appearance" scope="this device" />
            <div className="setting">
              <span className="setting-label">Font</span>
              {/* Each choice is shown in its own font */}
              <div className="font-choices">
                {(Object.keys(FONTS) as FontId[]).map((id) => (
                  <button
                    key={id}
                    className={id === appearance.font ? 'selected' : ''}
                    style={{ fontFamily: FONTS[id].css }}
                    aria-pressed={id === appearance.font}
                    onClick={() => update({ font: id })}
                  >
                    {FONTS[id].name}
                  </button>
                ))}
              </div>
            </div>

            {/* The note behind the dialog changes while dragging */}
            <label className="setting">
              <span className="setting-label">
                Text size <span className="setting-value">{appearance.fontSize} px</span>
              </span>
              <RulerSlider
                min={FONT_SIZE_MIN}
                max={FONT_SIZE_MAX}
                step={1}
                mark={DEFAULTS.fontSize}
                value={appearance.fontSize}
                onChange={(e) => update({ fontSize: Number(e.target.value) })}
              />
            </label>

            <label className="setting">
              <span className="setting-label">
                App scaling <span className="setting-value">{scale} %</span>
              </span>
              <RulerSlider
                min={SCALE_MIN}
                max={SCALE_MAX}
                step={5}
                mark={DEFAULTS.scale}
                value={scale}
                onChange={(e) => setScale(Number(e.target.value))}
                onPointerUp={applyScale}
                onKeyUp={applyScale}
                onBlur={applyScale}
              />
            </label>

            <SectionTitle title="Note list" scope="this device" />
            <label className="setting setting-toggle">
              <span>Show dates</span>
              <input
                type="checkbox"
                checked={appearance.showDates}
                onChange={(e) => update({ showDates: e.target.checked })}
              />
            </label>

            <SectionTitle title="Typing" scope="this device" />
            <label className="setting setting-toggle">
              <span>
                Smart typography <span className="setting-value">“ ” — → … ½ ©</span>
              </span>
              <input
                type="checkbox"
                checked={editing.smartTypography}
                onChange={(e) => updateEditing({ smartTypography: e.target.checked })}
              />
            </label>

            <SectionTitle title="Reminders" scope="this device" />
            <label className="setting setting-toggle">
              <span>Sound when a reminder is due</span>
              <input
                type="checkbox"
                checked={background.reminderSound}
                onChange={(e) => {
                  updateBackground({ reminderSound: e.target.checked })
                  if (e.target.checked) playChime() // a preview
                }}
              />
            </label>
          </div>
          <div className="settings-column">
            {isTauri() && (
              <>
                <SectionTitle title="Window" scope="this device" />
                <label className="setting setting-toggle">
                  <span>
                    ✕ hides SyncR in the tray{' '}
                    <span className="setting-value">keeps reminders working; Quit is in the tray menu</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={background.closeToTray}
                    onChange={(e) => updateBackground({ closeToTray: e.target.checked })}
                  />
                </label>
                <label className="setting setting-toggle">
                  <span>
                    Start with Windows <span className="setting-value">when you sign in</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={autostart ?? false}
                    disabled={autostart === null}
                    onChange={(e) => toggleAutostart(e.target.checked)}
                  />
                </label>
                <label className="setting setting-toggle">
                  <span>
                    Start hidden in the tray{' '}
                    <span className="setting-value">when started with Windows; otherwise the window shows</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={background.startHidden}
                    disabled={!autostart}
                    onChange={(e) => updateBackground({ startHidden: e.target.checked })}
                  />
                </label>
              </>
            )}

            <SectionTitle title="Notes" scope="all devices" />
            <div className="setting setting-toggle">
              <span>
                Color rules <span className="setting-value">{rulesSummary}</span>
              </span>
              <button className="setting-button" onClick={() => setShowRules(true)}>
                Edit…
              </button>
            </div>

            <GamesSettings />
            <GoogleSettings />

            <SectionTitle title="About" />
            {/* Check for updates: the icon next to Settings in the sidebar */}
            <div className="setting">
              <span>
                SyncR{' '}
                <span className="setting-value">
                  {/* Click the version: what's new in it */}
                  <button className="version-link" title="What's new" onClick={() => setShowWhatsNew(true)}>
                    v{__APP_VERSION__}
                  </button>{' '}
                  · by Logiinx
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Game search: the address and password of SyncR's IGDB proxy (igdb.ts), synced to all devices.
// The connection is checked by itself (when Settings opens, and shortly after typing stops):
// a green "Connected", or what went wrong.
const CHECK_DELAY = 800 // ms after the last key

// Address + password of the last check that worked, until the app closes (see GamesSettings)
let lastGoodConnection: string | null = null

function GamesSettings() {
  const saved = useConnection()
  const [connection, setConnection] = useState<IgdbConnection | null>(null) // null until loaded
  // Shown from the start, so the dialog doesn't grow when the first result comes in. The saved
  // connection loads a moment later: if one worked before, start on "Connected" (corrected below
  // if the saved one is different now)
  const [status, setStatus] = useState(() =>
    lastGoodConnection ? { ok: true, text: 'Connected' } : { ok: false, text: 'Waiting for connection…' },
  )
  const openedAt = useRef(Date.now())
  const [fullStatus, setFullStatus] = useState(false) // a long message, tapped: shown in full

  // The saved one, once loaded (not later: an older save arriving while typing would undo keys)
  useEffect(() => {
    if (saved) setConnection((current) => current ?? saved)
  }, [saved])

  useEffect(() => {
    if (!connection) return
    // Not set up: "Waiting for connection…" stays until Settings has been open for a second
    // (a brief flash of it looked jumpy), then "Not set up"
    if (!isComplete(connection)) {
      const wait = Math.max(0, 1000 - (Date.now() - openedAt.current))
      const timer = window.setTimeout(() => setStatus({ ok: false, text: 'Not set up' }), wait)
      return () => window.clearTimeout(timer)
    }
    // Same address and password as the last check that worked: "Connected" right away, and
    // the check below runs quietly (the status only changes if it fails now)
    const key = `${connection.url}\n${connection.password}`
    const knownGood = key === lastGoodConnection
    if (knownGood) setStatus({ ok: true, text: 'Connected' })
    let current = true
    const timer = window.setTimeout(async () => {
      if (!knownGood) setStatus({ ok: false, text: 'Checking…' })
      try {
        await igdb('games', 'fields name; limit 1;', connection)
        lastGoodConnection = key
        if (current) setStatus({ ok: true, text: 'Connected' })
      } catch (error) {
        if (lastGoodConnection === key) lastGoodConnection = null
        if (current) setStatus({ ok: false, text: error instanceof Error ? error.message : String(error) })
      }
    }, CHECK_DELAY)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [connection])

  function change(update: Partial<IgdbConnection>) {
    const next = { ...connection!, ...update }
    setConnection(next)
    saveConnection(next)
  }

  return (
    <>
      <SectionTitle title="Games" scope="all devices" />
      <label className="setting">
        <span className="setting-label">Game search proxy address</span>
        <input
          type="url"
          placeholder="https://….workers.dev"
          value={connection?.url ?? ''}
          onChange={(e) => change({ url: e.target.value.trim() })}
          disabled={!connection}
          spellCheck={false}
        />
      </label>
      <label className="setting">
        <span className="setting-label">Proxy password</span>
        <input
          type="password"
          value={connection?.password ?? ''}
          onChange={(e) => change({ password: e.target.value })}
          disabled={!connection}
          autoComplete="off"
        />
      </label>
      {/* One line (a long error would make the dialog grow on the phone): cut with …, the whole
          text on hover, or tap it to show it in full */}
      <p
        className={`setting-status${status.ok ? ' ok' : ''}${fullStatus ? ' full' : ''}`}
        title={status.text}
        onClick={() => setFullStatus(!fullStatus)}
      >
        {status.text}
      </p>
    </>
  )
}

// Google Calendar sign-in (google.ts), per device. Connect leaves the app for Google's page;
// the result shows under the cloud button on return. Needs the game search proxy (above).
function GoogleSettings() {
  const [connected, setConnected] = useState(isGoogleConnected)
  const [busy, setBusy] = useState(false)
  const proxy = useConnection()

  useEffect(() => {
    const refresh = () => setConnected(isGoogleConnected())
    window.addEventListener('google-change', refresh)
    return () => window.removeEventListener('google-change', refresh)
  }, [])

  // The PC app's sign-in (through the normal browser) comes in a later step
  const status = connected
    ? `Connected${googleName() ? ` as ${googleName()}` : ''}`
    : isTauri()
      ? 'Not available in the PC app yet'
      : !isComplete(proxy)
        ? 'Needs the game search proxy (above)'
        : 'Not connected'

  async function toggle() {
    setBusy(true)
    if (connected) await disconnectGoogle()
    else await connectGoogle() // leaves the app
    setBusy(false)
  }

  return (
    <>
      <SectionTitle title="Google Calendar" scope="this device" />
      <div className="setting setting-toggle">
        <span>
          Main calendar <span className="setting-value">{status}</span>
        </span>
        <button
          className="setting-button"
          disabled={busy || (!connected && (isTauri() || !isComplete(proxy)))}
          onClick={toggle}
        >
          {connected ? 'Disconnect' : 'Connect…'}
        </button>
      </div>
    </>
  )
}

// A slider with a ruler under it: one tick per value you can pick, a longer one at the
// default value. The handle is a vertical bar.
type RulerSliderProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  min: number
  max: number
  step: number
  value: number
  mark: number
}

function RulerSlider({ min, max, step, value, mark, ...input }: RulerSliderProps) {
  const ticks: number[] = []
  for (let v = min; v <= max; v += step) ticks.push(v)
  const fill = `${((value - min) / (max - min)) * 100}%`
  return (
    <div className="ruler" style={{ '--fill': fill } as React.CSSProperties}>
      <input type="range" min={min} max={max} step={step} value={value} {...input} />
      <div className="ruler-ticks" aria-hidden="true">
        {ticks.map((v) => (
          <span key={v} className={v === mark ? 'major' : undefined} />
        ))}
      </div>
    </div>
  )
}

// A group of settings: small title, and whether it applies to this device or all of them
function SectionTitle({ title, scope }: { title: string; scope?: string }) {
  return (
    <h3 className="settings-section">
      {title}
      {scope && <span className="settings-scope"> · {scope}</span>}
    </h3>
  )
}

export default SettingsDialog
