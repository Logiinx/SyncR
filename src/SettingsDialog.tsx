import { useEffect, useRef, useState } from 'react'
import { AppWindow, Bell, ChevronLeft, NotebookPen, Play, Plug, type LucideIcon } from 'lucide-react'
import { loadRuleGroups } from './colorRules'
import Window from './Window'
import InfoTip from './InfoTip'
import ColorRulesDialog from './ColorRulesDialog'
import { WhatsNewDialog, recentReleases } from './WhatsNew'
import { loadEditing, saveEditing, type Editing } from './editing'
import { isTauri } from '@tauri-apps/api/core'
import { playSound, SOUNDS, type SoundId } from './sounds'
import {
  connect as connectGoogle,
  connectedName as googleName,
  disconnect as disconnectGoogle,
  isConnected as isGoogleConnected,
} from './google'
import { igdb, isComplete, saveConnection, useConnection, type IgdbConnection } from './igdb'
import { connectGmail, removeAccount, setAccountColor, setAccountEnabled, useGmailAccounts } from './gmail'
import { forgetAccountMail } from './mailAlerts'
import { loadSafeSenders, removeSafeSender, SAFE_SENDERS_KEY } from './safeSenders'
import { loadProjectId, saveProjectId, useInstantStatus } from './instantMail'
import { colorMenuItems } from './cardColors'
import ContextMenu from './ContextMenu'
import { checkSteamProfile, followSteam, saveSteamFollow, saveSteamProfile, useSteamFollow, useSteamProfile, type SteamProfile } from './steam'
import {
  loadBackground,
  saveBackground,
  setStartWithWindows,
  startsWithWindows,
  type Background,
  type PopupCorner,
} from './desktop'
import { availableMonitors, primaryMonitor, type Monitor } from '@tauri-apps/api/window'
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
import Spinner from './Spinner'
import CloseButton from './CloseButton'

// Settings: four cards, all open at once (two columns on the PC, one on the phone), each
// setting one row: name on the left, its control on the right. The Accounts card shows how
// each connection is doing; "Manage accounts…" opens the details in the same window, with
// ← Back. Changes are saved right away. Closed with Escape or a click outside it.
function SettingsDialog({ onClose }: { onClose: () => void }) {
  // Focused when it opens (so Escape works), without scrolling: it opens at the top
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => dialogRef.current?.focus({ preventScroll: true }), [])
  const [manage, setManage] = useState(false) // the accounts' details instead of the cards
  function showManage(on: boolean) {
    setManage(on)
    dialogRef.current?.scrollTo({ top: 0 })
  }

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

  // The Accounts card: each connection's state (the details: "Manage accounts…")
  const mail = isTauri() || import.meta.env.DEV // Gmail: PC only (and the browser while developing)
  const gmailAccounts = useGmailAccounts()
  const instant = useInstantStatus()
  const proxyStatus = useProxyStatus(useConnection() ?? null)
  const steam = useSteamProfile()
  const [calendar, setCalendar] = useState(isGoogleConnected)
  useEffect(() => {
    const refresh = () => setCalendar(isGoogleConnected())
    window.addEventListener('google-change', refresh)
    return () => window.removeEventListener('google-change', refresh)
  }, [])

  if (showRules) return <ColorRulesDialog onClose={() => setShowRules(false)} />
  if (showWhatsNew) return <WhatsNewDialog releases={recentReleases()} onClose={() => setShowWhatsNew(false)} />

  const cards = (
    <div className="settings-cards">
      <SettingsCard icon={NotebookPen} title="Notes">
        <SettingRow label="Font">
          {/* Each choice is shown in its own font */}
          <select
            value={appearance.font}
            style={{ fontFamily: FONTS[appearance.font].css }}
            onChange={(e) => update({ font: e.target.value as FontId })}
          >
            {(Object.keys(FONTS) as FontId[]).map((id) => (
              <option key={id} value={id} style={{ fontFamily: FONTS[id].css }}>
                {FONTS[id].name}
              </option>
            ))}
          </select>
        </SettingRow>
        {/* The note behind the dialog changes while dragging */}
        <SettingRow label="Text size" value={`${appearance.fontSize} px`}>
          <RulerSlider
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            step={1}
            mark={DEFAULTS.fontSize}
            value={appearance.fontSize}
            aria-label="Text size"
            onChange={(e) => update({ fontSize: Number(e.target.value) })}
          />
        </SettingRow>
        <SettingRow label="Smart typography" value="“ ” — → … ½ ©">
          <input
            type="checkbox"
            checked={editing.smartTypography}
            onChange={(e) => updateEditing({ smartTypography: e.target.checked })}
          />
        </SettingRow>
        <SettingRow label="Dates in the note list">
          <input type="checkbox" checked={appearance.showDates} onChange={(e) => update({ showDates: e.target.checked })} />
        </SettingRow>
        <SettingRow label={<>Color rules <Synced /></>} value={rulesSummary}>
          <button className="setting-button" onClick={() => setShowRules(true)}>
            Edit…
          </button>
        </SettingRow>
      </SettingsCard>

      <SettingsCard icon={Bell} title="Alerts">
        {isTauri() && <PopupPlace background={background} onChange={updateBackground} />}
        <SettingRow label="Reminder sound">
          <SoundChoice value={background.reminderSoundId} onChange={(id) => updateBackground({ reminderSoundId: id })} />
        </SettingRow>
        {mail && gmailAccounts.length > 0 && (
          <>
            <SettingRow label="Email sound">
              <SoundChoice value={background.emailSoundId} onChange={(id) => updateBackground({ emailSoundId: id })} />
            </SettingRow>
            <SettingRow label="Email pop-ups fade" title="A faded email stays unread, as missed (Mail tab)">
              <select value={background.emailFade} onChange={(e) => updateBackground({ emailFade: Number(e.target.value) })}>
                {FADE_CHOICES.map(({ seconds, name }) => (
                  <option key={seconds} value={seconds}>
                    {seconds ? `after ${name}` : name}
                  </option>
                ))}
              </select>
            </SettingRow>
          </>
        )}
        {mail && gmailAccounts.length === 0 && (
          <SettingRow label="Emails">
            <button className="version-link" onClick={() => showManage(true)}>
              Add a Gmail account…
            </button>
          </SettingRow>
        )}
      </SettingsCard>

      <SettingsCard icon={Plug} title="Accounts">
        <SettingRow label={<>Game search <Synced /></>}>
          <Status ok={proxyStatus.ok} text={proxyStatus.text} />
        </SettingRow>
        <SettingRow label="Steam">
          <Status ok={!!steam?.name} text={steam?.name ?? (steam?.link ? 'Not checked yet' : 'Not set up')} />
        </SettingRow>
        <SettingRow label="Google Calendar">
          <Status ok={calendar} text={calendar ? `Connected${googleName() ? ` as ${googleName()}` : ''}` : 'Not connected'} />
        </SettingRow>
        {mail && (
          <SettingRow label="Gmail">
            <Status
              ok={gmailAccounts.length > 0}
              text={gmailAccounts.length === 0 ? 'No account yet'
                : `${gmailAccounts.length} account${gmailAccounts.length > 1 ? 's' : ''}${instant.ok ? ' · instant mail on' : ''}`}
            />
          </SettingRow>
        )}
        <div className="settings-card-foot">
          <button className="setting-button" onClick={() => showManage(true)}>
            Manage accounts…
          </button>
        </div>
      </SettingsCard>

      <SettingsCard icon={AppWindow} title="App">
        <SettingRow label="App scaling" value={`${scale} %`}>
          <RulerSlider
            min={SCALE_MIN}
            max={SCALE_MAX}
            step={5}
            mark={DEFAULTS.scale}
            value={scale}
            aria-label="App scaling"
            onChange={(e) => setScale(Number(e.target.value))}
            onPointerUp={applyScale}
            onKeyUp={applyScale}
            onBlur={applyScale}
          />
        </SettingRow>
        <SettingRow label="Animations">
          <input type="checkbox" checked={appearance.animations} onChange={(e) => update({ animations: e.target.checked })} />
        </SettingRow>
        {isTauri() && (
          <>
            <SettingRow label="✕ hides SyncR in the tray" title="Keeps reminders working; Quit is in the tray menu">
              <input
                type="checkbox"
                checked={background.closeToTray}
                onChange={(e) => updateBackground({ closeToTray: e.target.checked })}
              />
            </SettingRow>
            <SettingRow label="Start with Windows" title="When you sign in to Windows">
              <input
                type="checkbox"
                checked={autostart ?? false}
                disabled={autostart === null}
                onChange={(e) => toggleAutostart(e.target.checked)}
              />
            </SettingRow>
            <SettingRow label="Start hidden in the tray" title="When started with Windows; otherwise the window shows">
              <input
                type="checkbox"
                checked={background.startHidden}
                disabled={!autostart}
                onChange={(e) => updateBackground({ startHidden: e.target.checked })}
              />
            </SettingRow>
          </>
        )}
      </SettingsCard>
      {/* Under all cards. Check for updates: the icon next to Settings in the sidebar */}
      <p className="settings-about">
        SyncR{' '}
        {/* Click the version: what's new in it */}
        <button className="version-link" title="What's new" onClick={() => setShowWhatsNew(true)}>
          v{__APP_VERSION__}
        </button>
        {' '}· by Logiinx
      </p>
    </div>
  )

  return (
    <Window className="dialog settings" label="Settings" onClose={onClose} ref={dialogRef}>
      <div className="dialog-head">
        {manage ? (
          <button className="settings-back" onClick={() => showManage(false)}>
            <ChevronLeft size={18} /> Accounts
          </button>
        ) : (
          <h2>Settings</h2>
        )}
        <CloseButton onClick={onClose} />
      </div>
      {manage ? (
        <div className="settings-manage">
          <div>
            <GamesSettings />
          </div>
          <div>
            <GoogleSettings />
            {mail && <GmailSettings />}
            {mail && <SafeSenders />}
          </div>
        </div>
      ) : (
        cards
      )}
    </Window>
  )
}

// A card of settings: icon + title, then its rows
function SettingsCard({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <section className="settings-card">
      <h3 className="settings-card-title">
        <Icon size={15} /> {title}
      </h3>
      {children}
    </section>
  )
}

// One setting: its name (and a dim detail) on the left, its control on the right. `title`: a
// longer explanation on hover.
function SettingRow({ label, value, title, children }: {
  label: React.ReactNode
  value?: string
  title?: string
  children: React.ReactNode
}) {
  return (
    <div className="settings-row" title={title}>
      <span className="settings-row-label">
        {label}
        {value && <span className="setting-value"> {value}</span>}
      </span>
      <span className="settings-row-control">{children}</span>
    </div>
  )
}

// A connection's state in the Accounts card: green when it works, cut with … if long
function Status({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span className={`settings-status${ok ? ' ok' : ''}`} title={text}>
      {text === 'Checking…' && <Spinner size={12} />}
      {text}
    </span>
  )
}

// Shared by all devices (synced through Dropbox); everything else is for this device only
function Synced() {
  return <span className="settings-synced">synced</span>
}

// Game search: the address and password of SyncR's IGDB proxy (igdb.ts), synced to all devices.
// The connection is checked by itself (when Settings opens, and shortly after typing stops):
// a green "Connected", or what went wrong.
const CHECK_DELAY = 800 // ms after the last key

// Address + password of the last check that worked, until the app closes (see GamesSettings)
let lastGoodConnection: string | null = null

// Whether the proxy answers with this address + password: "Connected", or what went wrong.
// Shown from the start, so the dialog doesn't grow when the first result comes in. The saved
// connection loads a moment later: if one worked before, start on "Connected" (corrected below
// if the saved one is different now)
function useProxyStatus(connection: IgdbConnection | null) {
  const [status, setStatus] = useState(() =>
    lastGoodConnection ? { ok: true, text: 'Connected' } : { ok: false, text: 'Waiting for connection…' },
  )
  const openedAt = useRef(Date.now())

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
  return status
}

function GamesSettings() {
  const saved = useConnection()
  const [connection, setConnection] = useState<IgdbConnection | null>(null) // null until loaded
  const status = useProxyStatus(connection)
  const [fullStatus, setFullStatus] = useState(false) // a long message, tapped: shown in full

  // The saved one, once loaded (not later: an older save arriving while typing would undo keys)
  useEffect(() => {
    if (saved) setConnection((current) => current ?? saved)
  }, [saved])

  function change(update: Partial<IgdbConnection>) {
    const next = { ...connection!, ...update }
    setConnection(next)
    saveConnection(next)
  }

  return (
    <section className="settings-group">
      <SectionTitle title="Games" synced />
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
        {status.text === 'Checking…' && <Spinner size={12} />}
        {status.text}
      </p>
      <SteamSetting proxyReady={status.ok} />
    </section>
  )
}

// Your Steam profile (steam.ts), synced: checked like the proxy above, shortly after typing
// stops and when Settings opens. Its id and name are saved once found.
function SteamSetting({ proxyReady }: { proxyReady: boolean }) {
  const saved = useSteamProfile()
  const follow = useSteamFollow()
  const [profile, setProfile] = useState<SteamProfile | null>(null) // null until loaded
  const [status, setStatus] = useState({ ok: false, text: '' })

  useEffect(() => {
    if (saved) setProfile((current) => current ?? saved)
  }, [saved])

  useEffect(() => {
    if (!profile) return
    if (!profile.link.trim()) return setStatus({ ok: false, text: 'Not set up' })
    if (!proxyReady) return setStatus({ ok: false, text: 'Needs the game search proxy (above)' })
    if (profile.name) setStatus({ ok: true, text: `Connected as ${profile.name}` })
    let current = true
    const timer = window.setTimeout(async () => {
      if (!profile.name) setStatus({ ok: false, text: 'Checking…' })
      try {
        const found = await checkSteamProfile(profile.link)
        const name = found.name ?? found.steamId
        if (!current) return // another link was typed meanwhile: don't save over it
        if (found.steamId !== profile.steamId || name !== profile.name) {
          await saveSteamProfile({ link: profile.link, steamId: found.steamId, name })
        }
        if (found.games === null) setStatus({ ok: false, text: `${name}: game details are private (Steam → Profile → Privacy)` })
        else setStatus({ ok: true, text: `Connected as ${name} · ${found.games} games` })
      } catch (error) {
        if (current) setStatus({ ok: false, text: error instanceof Error ? error.message : String(error) })
      }
    }, CHECK_DELAY)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.link, proxyReady])

  return (
    <>
      <label className="setting">
        <span className="setting-label">Steam profile</span>
        <input
          type="url"
          placeholder="https://steamcommunity.com/id/…"
          value={profile?.link ?? ''}
          onChange={(e) => {
            // A new link: the id and name come with its check
            const next = { link: e.target.value.trim() }
            setProfile(next)
            saveSteamProfile(next)
          }}
          disabled={!profile}
          spellCheck={false}
        />
      </label>
      <p className={`setting-status${status.ok ? ' ok' : ''}`} title={status.text}>
        {status.text === 'Checking…' && <Spinner size={12} />}
        {status.text}
      </p>
      {/* Games move by themselves (steam.ts followSteam); checked right away when switched on */}
      <SettingRow
        label={
          <>
            Follow my Steam account
            <InfoTip label="How Follow my Steam account works">
              Moves games for you, based on your Steam account (checked about every 30 minutes):
              <ul>
                <li>
                  A <b>To buy</b> game you own on Steam → <b>To play › Not started</b>
                </li>
                <li>
                  A <b>Not started</b> game you play for 1 hour on Steam → <b>Playing</b>
                </li>
              </ul>
              Each move shows a line at the top of Games. Nothing else moves, and you can always move a game back.
            </InfoTip>
          </>
        }
      >
        <input
          type="checkbox"
          checked={!!follow}
          disabled={follow === undefined}
          onChange={async (e) => {
            const on = e.target.checked // read first: the box shows the saved value again meanwhile
            await saveSteamFollow(on)
            if (on) followSteam(true)
          }}
        />
      </SettingRow>
    </>
  )
}

// Google Calendar sign-in (google.ts), per device. Phone/browser: Connect leaves the app for
// Google's page; the result shows under the cloud button on return. PC app: Google's page opens
// in the browser; the result shows here. Needs the game search proxy (above).
function GoogleSettings() {
  const [connected, setConnected] = useState(isGoogleConnected)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null) // PC app: waiting, or what went wrong
  const proxy = useConnection()

  useEffect(() => {
    const refresh = () => setConnected(isGoogleConnected())
    window.addEventListener('google-change', refresh)
    return () => window.removeEventListener('google-change', refresh)
  }, [])

  const status = connected
    ? `Connected${googleName() ? ` as ${googleName()}` : ''}`
    : (message ?? (!isComplete(proxy) ? 'Needs the game search proxy (above)' : 'Not connected'))

  async function toggle() {
    setBusy(true)
    setMessage(null)
    try {
      if (connected) await disconnectGoogle()
      else {
        // Phone/browser: leaves the app. PC app: waits here for the sign-in in the browser
        if (isTauri()) setMessage('Finish the sign-in in your browser…')
        const result = await connectGoogle()
        setMessage(result && !result.ok ? result.text : null)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
    setBusy(false)
  }

  return (
    <section className="settings-group">
      <SectionTitle title="Google Calendar" />
      <div className="setting setting-toggle">
        <span>Main calendar</span>
        <button
          className="setting-button"
          disabled={busy || (!connected && !isComplete(proxy))}
          onClick={toggle}
        >
          {connected ? 'Disconnect' : 'Connect…'}
        </button>
      </div>
      {/* Same status line as Games: green when connected */}
      <p className={`setting-status${connected ? ' ok' : ''}`} title={status}>
        {busy && !connected && isTauri() && <Spinner size={12} />}
        {status}
      </p>
    </section>
  )
}

// Email pop-ups fade by themselves after… (0: they stay until closed)
const FADE_CHOICES = [
  { seconds: 0, name: 'Never' },
  { seconds: 10, name: '10 s' },
  { seconds: 30, name: '30 s' },
  { seconds: 60, name: '1 min' },
]

// Gmail accounts (gmail.ts): PC only (the phone has the Gmail app); also in the browser while
// developing, to test. Each account: its color (the strip on its pop-ups), address, on/off
// (off: no pop-ups, not in the Mail tab), Remove. Sound and fading: in Alerts. "Add account…" opens Google's sign-in like Calendar's (needs the proxy too).
// Instant mail (instantMail.ts): the Google Cloud project ID, and a sign-in of the project's
// owner (one of the accounts) with the Pub/Sub permission.
function GmailSettings() {
  const accounts = useGmailAccounts()
  const [projectId, setProjectId] = useState(loadProjectId)
  const instant = useInstantStatus()
  const collector = accounts.find((a) => a.pubsub && !a.expired)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const [colorMenu, setColorMenu] = useState<{ email: string; color: string; x: number; y: number } | null>(null)
  const proxy = useConnection()

  async function add(pubsub = false) {
    setBusy(true)
    setMessage(isTauri() ? { text: 'Finish the sign-in in your browser…', ok: false } : null)
    try {
      setMessage(await connectGmail(pubsub)) // browser: leaves the app
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : String(error), ok: false })
    }
    setBusy(false)
  }

  const status = message?.text ??
    (!isComplete(proxy) ? 'Needs the game search proxy (above)' : accounts.length === 0 ? 'No account yet' : null)
  return (
    <>
    <section className="settings-group">
      <SectionTitle title="Gmail" />
      {accounts.map((account) => (
        <div key={account.email} className="setting setting-toggle gmail-account">
          <span className="gmail-account-name" title={account.email}>
            {/* The account's color (its pop-ups' strip, its dot in the Mail tab): a click
                opens the color list, like Board cards' "Color…" */}
            <button
              className="gmail-account-color"
              title="Color"
              aria-label="Color"
              onClick={(e) => setColorMenu({ email: account.email, color: account.color, x: e.clientX, y: e.clientY })}
            >
              <span className="menu-swatch" style={{ background: `var(--text-${account.color})` }} />
            </button>
            <span className="gmail-account-email" title={account.email}>{account.email}</span>
            {account.expired && <span className="setting-value">signed out</span>}
          </span>
          {account.expired ? (
            // The instant mail account asks for the Pub/Sub permission again, or it would lose it
            <button className="setting-button" disabled={busy} onClick={() => add(account.pubsub)}>
              Sign in…
            </button>
          ) : (
            <input
              type="checkbox"
              checked={account.enabled}
              title="On: pop-ups for new emails, and in the Mail tab"
              onChange={(e) => setAccountEnabled(account.email, e.target.checked)}
            />
          )}
          <button
            className="setting-button"
            onClick={() => {
              removeAccount(account.email)
              forgetAccountMail(account.email) // its stored emails go too (privacy page)
            }}
          >
            Remove
          </button>
        </div>
      ))}
      <div className="setting setting-toggle">
        <span>New emails in Primary</span>
        <button className="setting-button" disabled={busy || !isComplete(proxy)} onClick={() => add()}>
          Add account…
        </button>
      </div>
      {status && (
        <p className={`setting-status${message?.ok ? ' ok' : ''}`} title={status}>
          {busy && isTauri() && <Spinner size={12} />}
          {status}
        </p>
      )}
      {colorMenu && (
        <ContextMenu
          x={colorMenu.x}
          y={colorMenu.y}
          onClose={() => setColorMenu(null)}
          items={colorMenuItems(colorMenu.color, (color) => color && setAccountColor(colorMenu.email, color), false)}
        />
      )}
    </section>
      {accounts.length > 0 && (
        <section className="settings-group">
          <SectionTitle title="Instant mail" />
          <label className="setting">
            <span className="setting-label">Google Cloud project ID</span>
            <input
              type="text"
              placeholder="e.g. syncr-123456"
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value.trim())
                saveProjectId(e.target.value.trim())
              }}
              spellCheck={false}
            />
          </label>
          <div className="setting setting-toggle">
            <span>
              Pub/Sub permission <span className="setting-value">{collector?.email ?? 'not yet'}</span>
            </span>
            <button className="setting-button" disabled={busy || !isComplete(proxy)} onClick={() => add(true)}>
              Sign in…
            </button>
          </div>
          {instant.text && (
            <p className={`setting-status${instant.ok ? ' ok' : ''}`} title={instant.text}>
              {instant.text}
            </p>
          )}
        </section>
      )}
    </>
  )
}

// Safe senders (safeSenders.ts): their emails open with web images. Added from an email
// ("Always for …"), removed here. The list follows changes made meanwhile in the pop-up window.
function SafeSenders() {
  const [list, setList] = useState(loadSafeSenders)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === SAFE_SENDERS_KEY && setList(loadSafeSenders())
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  return (
    <section className="settings-group">
      <SectionTitle title="Safe senders" />
      {list.map((entry) => (
        <div key={entry} className="setting setting-toggle">
          <span className="gmail-account-name">
            <span className="gmail-account-email" title={entry}>{entry}</span>
          </span>
          <button
            className="setting-button"
            onClick={() => {
              removeSafeSender(entry)
              setList(loadSafeSenders())
            }}
          >
            Remove
          </button>
        </div>
      ))}
      <p className="setting-status" title='Web images show by themselves in their emails. Add one from an email: "Always for …"'>
        {list.length ? 'Web images show by themselves in their emails' : 'None yet. Add one from an email: "Always for …"'}
      </p>
    </section>
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

// A choice of sounds (sounds.ts): a dropdown, and ▶ to hear it again (picking one plays it)
function SoundChoice({ value, onChange }: { value: SoundId; onChange: (id: SoundId) => void }) {
  return (
    <>
      <select
        value={value}
        onChange={(e) => {
          onChange(e.target.value as SoundId)
          playSound(e.target.value as SoundId)
        }}
      >
        {SOUNDS.map(({ id, name }) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
      <button className="settings-play" title="Play" aria-label="Play" disabled={value === 'none'} onClick={() => playSound(value)}>
        <Play size={13} />
      </button>
    </>
  )
}

const CORNERS: { id: PopupCorner; name: string }[] = [
  { id: 'top-left', name: 'Top left' },
  { id: 'top-right', name: 'Top right' },
  { id: 'bottom-left', name: 'Bottom left' },
  { id: 'bottom-right', name: 'Bottom right' },
]

// PC: where the pop-up shows (screen + corner), e.g. on a second screen, away from a game.
// The screens are read from Windows when Settings opens; a chosen screen that isn't plugged
// in is kept, and the pop-up uses the main screen meanwhile.
function PopupPlace({
  background,
  onChange,
}: {
  background: Background
  onChange: (change: Partial<Background>) => void
}) {
  const [screens, setScreens] = useState<{ name: string | null; label: string; size: string }[]>([])
  useEffect(() => {
    Promise.all([availableMonitors(), primaryMonitor()])
      .then(([monitors, main]) => {
        const others = monitors.filter((m) => m.name !== main?.name).sort((a, b) => a.position.x - b.position.x)
        const size = (m: Monitor) => `${m.size.width} × ${m.size.height}`
        setScreens([
          { name: null, label: 'Main screen', size: main ? size(main) : '' },
          ...others.map((m, i) => ({ name: m.name, label: `Screen ${i + 2}`, size: size(m) })),
        ])
      })
      .catch((error) => console.error(error))
  }, [])
  const unplugged =
    background.popupScreen !== null && screens.length > 0 && !screens.some((s) => s.name === background.popupScreen)
  return (
    <>
      <SettingRow
        label="Pop-up screen"
        title={unplugged ? "The chosen screen isn't plugged in: main screen meanwhile" : undefined}
        value={unplugged ? 'not plugged in' : undefined}
      >
        <select
          value={background.popupScreen ?? ''}
          onChange={(e) => onChange({ popupScreen: e.target.value || null })}
        >
          {unplugged && <option value={background.popupScreen!}>Unplugged screen</option>}
          {screens.map((screen) => (
            <option key={screen.name ?? ''} value={screen.name ?? ''}>
              {screen.label}{screen.size && ` (${screen.size})`}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow label="Pop-up corner">
        <select value={background.popupCorner} onChange={(e) => onChange({ popupCorner: e.target.value as PopupCorner })}>
          {CORNERS.map(({ id, name }) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </SettingRow>
    </>
  )
}

// A group of settings: small title, "synced" if it applies to all devices
function SectionTitle({ title, synced }: { title: string; synced?: boolean }) {
  return (
    <h3 className="settings-section">
      {title}
      {synced && <> <Synced /></>}
    </h3>
  )
}

export default SettingsDialog
