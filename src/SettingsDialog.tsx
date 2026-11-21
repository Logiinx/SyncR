import { Fragment, useEffect, useRef, useState } from 'react'
import { AppWindow, Bell, ChevronLeft, ChevronRight, Cpu, Gamepad2, Link, Mail, NotebookPen, Palette, Play, Plug, Video, X } from 'lucide-react'
import { loadRuleGroups } from './colorRules'
import Window from './Window'
import { RowStatus, SettingRow } from './SettingsCard'
import { SettingsResults, SettingsSearchBox } from './SettingsSearch'
import InfoTip from './InfoTip'
import ColorRulesDialog from './ColorRulesDialog'
import { WhatsNewDialog, recentReleases } from './WhatsNew'
import { loadEditing, saveEditing, type Editing } from './editing'
import {
  CARD_STYLES,
  DEFAULT_SITES,
  GROUP_STYLES,
  CARD_ORDERS,
  HOVER_SIZES,
  loadLinkPreviewSettings,
  parseSites,
  saveLinkPreviewSettings,
  type CardStyle,
  type GroupStyle,
  type CardOrder,
  type HoverSize,
  type LinkPreviewSettings,
} from './linkPreviews'
import { isTauri } from '@tauri-apps/api/core'
import { playSound, SOUNDS, type SoundId } from './sounds'
import {
  connect as connectGoogle,
  connectedName as googleName,
  disconnect as disconnectGoogle,
  isConnected as isGoogleConnected,
} from './google'
import { igdb, isComplete, saveConnection, useConnection, type IgdbConnection } from './igdb'
import { useVideoEnabled } from './video'
import VideoSection from './VideoSettings'
import GamesSection from './GamesSettings'
import HardwareSection from './HardwareSettings'
import MailSection from './MailSettings'
import { useModuleOn } from './modules'
import { useMouseBattery } from './mouseBattery'
import { useHardware } from './hardware'
import type { SettingsStart } from './openSettings'
import { useGmailAccounts } from './gmail'
import { useInstantStatus } from './instantMail'
import { signalsWork } from './updateSignal'
import { colorMenuItems } from './cardColors'
import ContextMenu from './ContextMenu'
import { SpecialIcon, type SpecialTab } from './tabIcons'
import { saveTabColors, useTabColors } from './tabColors'
import { useSteamProfile } from './steam'
import {
  findPopupScreen,
  loadBackground,
  popupScreenChange,
  saveBackground,
  screenSpot,
  setStartWithWindows,
  showTray,
  startsWithWindows,
  type Background,
  type MailDrag,
  type PopupCorner,
} from './desktop'
import { availableMonitors, primaryMonitor, type Monitor } from '@tauri-apps/api/window'
import {
  DEFAULTS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  fontName,
  FONTS,
  loadAppearance,
  saveAppearance,
  SCALE_MAX,
  SCALE_MIN,
  type Appearance,
  type FontId,
  type SyncSign,
} from './appearance'
import Spinner from './Spinner'
import CloseButton from './CloseButton'
import PinDialog, { type PinDialogMode } from './PinDialog'
import { pinLockOn } from './secrets'
import { getKey } from './crypto'
import { ALL_DAY_ALERTS, allDayAlertText, saveAllDayAlert, useAllDayAlert } from './eventAlerts'
import { percentText, plural, t, textKey, useLanguage, validChoice, type TextKey } from './i18n'
import SecretField from './SecretField'
import { useNarrow } from './useNarrow'
import { read, write } from './localState'
import { saveLanguageChoice, useLanguageChoice } from './language'

// Settings: a sidebar of sections, one shown at a time on its right (on a phone the list fills
// the window and a section opens in its place). Each setting one row: name on the left, its
// control on the right. Each connection is set up in its section (Steam in Games, Google Calendar
// in Alerts, Gmail in Mail); Accounts holds the game search proxy they share and shows how each
// one is doing, a click opening its section. Changes are saved right away.
// Closed with Escape or a click outside it.
// start: opens on that section instead of the last one (a module's ⚙️, the taskbar battery, the
// Hardware widget's menu: openSettings.ts)
function SettingsDialog({ onClose, start }: { onClose: () => void; start?: SettingsStart }) {
  // Focused when it opens (so Escape works), without scrolling: it opens at the top. On the PC
  // the cursor goes in the search box, to type right away (a phone would pop up its keyboard).
  const dialogRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const narrow = useNarrow()
  useEffect(() => (narrow ? dialogRef : searchRef).current?.focus({ preventScroll: true }), [])
  // Search (SettingsSearch.tsx): while it has text, the results take the section's place (phone:
  // the list's place)
  const [query, setQuery] = useState('')
  const searching = query.trim() !== ''
  function search(text: string) {
    setQuery(text)
    pageRef.current?.scrollTo({ top: 0 })
  }
  // The section shown on the right of the sidebar: the last one looked at on this device (PC).
  // On a phone the list shows first and a section opens in its place (phoneOpen).
  const startSection = start === 'mouse-battery' ? 'hardware' : start
  const [section, setSection] = useState(() => {
    if (startSection) write(SECTION_KEY, startSection)
    return startSection ?? read(SECTION_KEY, 'notes')
  })
  const [phoneOpen, setPhoneOpen] = useState(!!startSection)
  const pageRef = useRef<HTMLDivElement>(null)
  // part: a selector inside the section to scroll to (Accounts' rows: Steam, Google Calendar; the
  // taskbar battery: Hardware's mouse battery, at the bottom)
  const partToShow = useRef<string | null>(start === 'mouse-battery' ? '.mouse-battery-part' : null)
  function openSection(id: string, part?: string) {
    setQuery('')
    setSection(id)
    write(SECTION_KEY, id)
    setPhoneOpen(true)
    pageRef.current?.scrollTo({ top: 0 })
    partToShow.current = part ?? null
  }
  useEffect(() => {
    // The focus back in Settings when the button clicked went away (a result, Accounts' rows), so
    // Escape still closes it
    if (!dialogRef.current?.contains(document.activeElement)) dialogRef.current?.focus({ preventScroll: true })
    const page = pageRef.current
    const selector = partToShow.current
    partToShow.current = null
    if (!page || !selector) return
    const show = () => {
      const part = page.querySelector<HTMLElement>(selector)
      if (part) page.scrollTop = part.offsetTop - 6
    }
    show()
    // Again a moment later: a check's line (Steam's) comes in after, making the page longer
    const timer = window.setTimeout(show, 400)
    return () => window.clearTimeout(timer)
  }, [section, phoneOpen, searching])

  const [appearance, setAppearance] = useState(loadAppearance)
  function update(change: Partial<Appearance>) {
    // Start from the saved settings (always current), not from `appearance`, which may not
    // have caught up yet when two changes come quickly after each other
    const next = { ...loadAppearance(), ...change }
    setAppearance(next)
    saveAppearance(next)
  }

  const [links, setLinks] = useState(loadLinkPreviewSettings)
  const videoOn = useVideoEnabled() // the Worker allows Video here
  const mailOn = useModuleOn('mail')
  const videoModuleOn = useModuleOn('video')
  const gamesOn = useModuleOn('games')
  function updateLinks(change: Partial<LinkPreviewSettings>) {
    saveLinkPreviewSettings(change)
    setLinks(loadLinkPreviewSettings())
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
    if ('closeToTray' in change || 'startHidden' in change) showTray(next)
  }

  // Read from Windows (null = not known yet). If changing it fails, show the real state again.
  const [autostart, setAutostart] = useState<boolean | null>(null)
  useEffect(() => {
    startsWithWindows().then(setAutostart, () => setAutostart(false))
  }, [])
  function toggleAutostart(on: boolean) {
    setAutostart(on)
    setStartWithWindows(on)
      .catch((error) => {
        console.error(error)
        startsWithWindows().then(setAutostart)
      })
      .finally(() => showTray())
  }

  // The slider shows the new value while dragging; the app is scaled when it's released
  // (scaling while dragging would move the slider away under the finger).
  const [scale, setScale] = useState(appearance.scale)
  function applyScale() {
    if (scale !== appearance.scale) update({ scale })
  }

  // Color rules open in their own window (more room); back here when it closes
  const [showRules, setShowRules] = useState(false)
  const mouseBattery = useMouseBattery()
  const hardware = useHardware()
  const [rulesSummary, setRulesSummary] = useState('')
  const language = useLanguage()
  useEffect(() => {
    if (showRules) return
    loadRuleGroups().then((groups) => {
      const on = groups.filter((g) => g.enabled).flatMap((g) => g.rules.filter((r) => r.enabled && r.words.trim()))
      setRulesSummary(groups.length === 0 ? t('None yet') : plural(on.length, '{n} on|one', '{n} on'))
    })
  }, [showRules, language])

  // "What's new" also opens in place of Settings, like the color rules
  const [showWhatsNew, setShowWhatsNew] = useState(false)

  // PIN lock (PC, pinLock.ts): needs sync set up (its passphrase opens a forgotten PIN)
  const [pinOn, setPinOn] = useState(pinLockOn)
  const [pinDialog, setPinDialog] = useState<PinDialogMode | null>(null)
  const [syncReady, setSyncReady] = useState<boolean | null>(null)
  useEffect(() => {
    if (!isTauri()) return
    const check = () => void getKey().then((key) => setSyncReady(key !== undefined))
    check()
    window.addEventListener('sync-key-change', check)
    return () => window.removeEventListener('sync-key-change', check)
  }, [])

  // Accounts: the game search proxy, and the state of the connections set up in other sections
  const mail = isTauri() || import.meta.env.DEV // Gmail: PC only (and the browser while developing)
  const gmailAccounts = useGmailAccounts()
  const allDayAlert = useAllDayAlert()
  const languageChoice = useLanguageChoice()
  // The special tabs' icon colors: one button per tab this device has, a click opens the color list
  const tabColors = useTabColors()
  const [tabColorMenu, setTabColorMenu] = useState<{ kind: SpecialTab; x: number; y: number } | null>(null)
  const [syncColorMenu, setSyncColorMenu] = useState<{ x: number; y: number } | null>(null)
  const tabNames: Record<SpecialTab, string> = { games: t('Games'), reminders: t('Reminders'), mail: t('Mail'), video: t('Video') }
  const colorTabs: SpecialTab[] = [
    'games',
    'reminders',
    ...(isTauri() || import.meta.env.DEV ? (['mail'] as const) : []),
    ...(videoOn ? (['video'] as const) : []),
  ]
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
  if (pinDialog) return <PinDialog mode={pinDialog} onClose={() => { setPinDialog(null); setPinOn(pinLockOn()) }} />
  if (showWhatsNew) return <WhatsNewDialog releases={recentReleases()} onClose={() => setShowWhatsNew(false)} />

  // The sections' contents (Window: PC only), listed in the sidebar at the end; the modules' own
  // in their files (VideoSettings, GamesSettings, HardwareSettings.tsx)
  const notesCard = (
    <>
      <SettingRow label={t('Font')}>
        {/* Each choice is shown in its own font */}
        <select
          value={appearance.font}
          style={{ fontFamily: FONTS[appearance.font].css }}
          onChange={(e) => update({ font: e.target.value as FontId })}
        >
          {(Object.keys(FONTS) as FontId[]).map((id) => (
            <option key={id} value={id} style={{ fontFamily: FONTS[id].css }}>
              {fontName(id)}
            </option>
          ))}
        </select>
      </SettingRow>
      {/* The note behind the dialog changes while dragging */}
      <SettingRow label={t('Text size')} value={`${appearance.fontSize} px`}>
        <RulerSlider
          min={FONT_SIZE_MIN}
          max={FONT_SIZE_MAX}
          step={1}
          mark={DEFAULTS.fontSize}
          value={appearance.fontSize}
          aria-label={t('Text size')}
          onChange={(e) => update({ fontSize: Number(e.target.value) })}
        />
      </SettingRow>
      <SettingRow label={t('Smart typography')} value="“ ” — → … ½ ©">
        <input
          type="checkbox"
          checked={editing.smartTypography}
          onChange={(e) => updateEditing({ smartTypography: e.target.checked })}
        />
      </SettingRow>
      <SettingRow label={t('Dates in the note list')}>
        <input type="checkbox" checked={appearance.showDates} onChange={(e) => update({ showDates: e.target.checked })} />
      </SettingRow>
      <SettingRow label={<>{t('Color rules')} <Synced /></>}>
        {/* The count is in the button: beside the name, the French doesn't fit on one line */}
        <button className="setting-button" onClick={() => setShowRules(true)}>
          {rulesSummary && `${rulesSummary} · `}{t('Edit…')}
        </button>
      </SettingRow>
    </>
  )
  const linksCard = (
    <>
      <SettingRow
        label={
          <>
            {t('Link cards')}
            <InfoTip label={t('About link cards')}>
              {t('A website link whose text is its address shows as a card with its title, description and picture. A click opens it; put the cursor on it to edit the address. Links with their own text stay as they are.')}
            </InfoTip>
          </>
        }
      >
        <select value={links.style} onChange={(e) => updateLinks({ style: e.target.value as CardStyle })}>
          {(Object.keys(CARD_STYLES) as CardStyle[]).map((id) => (
            <option key={id} value={id}>
              {t(CARD_STYLES[id])}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow
        label={
          <>
            {t('Card order')}
            <InfoTip label={t('About card order')}>
              {t('Post first: a post shows its text and picture before who wrote it, and other links show their picture instead of the site’s icon.')}
            </InfoTip>
          </>
        }
      >
        <select
          value={links.order}
          disabled={links.style === 'off' && links.hover === 'off'}
          onChange={(e) => updateLinks({ order: e.target.value as CardOrder })}
        >
          {(Object.keys(CARD_ORDERS) as CardOrder[]).map((id) => (
            <option key={id} value={id}>
              {t(CARD_ORDERS[id])}
            </option>
          ))}
        </select>
      </SettingRow>
      {/* Only where there's a mouse (a phone can't hover) */}
      {matchMedia('(hover: hover)').matches && (
        <SettingRow
          label={
            <>
              {t('Hover card')}
              <InfoTip label={t('About hover cards')}>{t('Shown while the mouse is on a link card, and on links with their own text.')}</InfoTip>
            </>
          }
        >
          <select value={links.hover} onChange={(e) => updateLinks({ hover: e.target.value as HoverSize })}>
            {(Object.keys(HOVER_SIZES) as HoverSize[]).map((id) => (
              <option key={id} value={id}>
                {t(HOVER_SIZES[id])}
              </option>
            ))}
          </select>
        </SettingRow>
      )}
      <SettingRow
        label={
          <>
            {t('Link groups')}
            <InfoTip label={t('About link groups')}>
              {t('2 or more lines in a row holding only a link card: as a list, side by side (grid), as small chips, or folded into one line.')}
            </InfoTip>
          </>
        }
      >
        <select
          value={links.groups}
          disabled={links.style === 'off'}
          onChange={(e) => updateLinks({ groups: e.target.value as GroupStyle })}
        >
          {(Object.keys(GROUP_STYLES) as GroupStyle[]).map((id) => (
            <option key={id} value={id}>
              {t(GROUP_STYLES[id])}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow
        label={
          <>
            {t('Cards for')} <Synced />
          </>
        }
      >
        <select
          value={links.allSites ? 'all' : 'sites'}
          disabled={links.style === 'off' && links.hover === 'off'}
          onChange={(e) => updateLinks({ allSites: e.target.value === 'all' })}
        >
          <option value="sites">{t('These sites')}</option>
          <option value="all">{t('All links')}</option>
        </select>
      </SettingRow>
      <SettingRow
        className="settings-row-sites"
        label={
          <>
            {t('Sites')} <Synced />
            <InfoTip label={t('About sites')}>{t('Links to these sites (and their subdomains) get a card. Separate them with commas.')}</InfoTip>
          </>
        }
      >
        <SitesInput
          sites={links.sites}
          disabled={(links.style === 'off' && links.hover === 'off') || links.allSites}
          onChange={(sites) => updateLinks({ sites })}
        />
      </SettingRow>
    </>
  )
  const alertsCard = (
    <>
      {isTauri() && (
        <>
          <h4 className="settings-card-sub">{t('Pop-up')}</h4>
          <PopupPlace background={background} onChange={updateBackground} />
        </>
      )}
      <h4 className="settings-card-sub calendar-part">{t('Reminders')}</h4>
      <CalendarRow />
      <SettingRow label={t('Reminder sound')}>
        <SoundChoice value={background.reminderSoundId} onChange={(id) => updateBackground({ reminderSoundId: id })} />
      </SettingRow>
      <SettingRow
        label={
          <>
            {t('All-day events')} <Synced />
            <InfoTip label={t('About all-day alerts')}>
              {t("Google doesn't share its default alert for all-day events with apps. SyncR uses this one for all-day events that have no alert it can see.")}
            </InfoTip>
          </>
        }
      >
        {allDayAlert !== undefined && (
          <select
            value={allDayAlert === null ? 'none' : String(allDayAlert)}
            onChange={(e) => saveAllDayAlert(e.target.value === 'none' ? null : Number(e.target.value))}
          >
            {ALL_DAY_ALERTS.map((minutes) => (
              <option key={String(minutes)} value={minutes === null ? 'none' : String(minutes)}>
                {minutes === null ? t('No alert') : allDayAlertText(minutes)}
              </option>
            ))}
          </select>
        )}
      </SettingRow>
      {mail && gmailAccounts.length > 0 && (
        <>
          <h4 className="settings-card-sub">{t('Emails')}</h4>
          <SettingRow label={t('Email sound')}>
            <SoundChoice value={background.emailSoundId} onChange={(id) => updateBackground({ emailSoundId: id })} />
          </SettingRow>
          <SettingRow
            label={
              <>
                {t('Email pop-ups fade')}
                <InfoTip label={t('About fading')}>{t('A faded email stays unread, as missed (Mail tab).')}</InfoTip>
              </>
            }
          >
            <select value={background.emailFade} onChange={(e) => updateBackground({ emailFade: Number(e.target.value) })}>
              {FADE_CHOICES.map(({ seconds, name }) => (
                <option key={seconds} value={seconds}>
                  {seconds ? t('after {time}', { time: name }) : t('Never')}
                </option>
              ))}
            </select>
          </SettingRow>
          <SettingRow
            label={
              <>
                {t('Drag an email right')}
                <InfoTip label={t('About dragging emails')}>
                  {t('In the Mail tab and on email pop-ups: press an email and drag it sideways, then let go once its action shows in color.')}
                </InfoTip>
              </>
            }
          >
            <MailDragChoice value={background.emailDragRight} onChange={(emailDragRight) => updateBackground({ emailDragRight })} />
          </SettingRow>
          <SettingRow label={t('Drag an email left')}>
            <MailDragChoice value={background.emailDragLeft} onChange={(emailDragLeft) => updateBackground({ emailDragLeft })} />
          </SettingRow>
        </>
      )}
      {mail && gmailAccounts.length === 0 && (
        <SettingRow label={t('Emails')}>
          <button className="setting-button" onClick={() => openSection('mail')}>
            {t('Add account…')}
          </button>
        </SettingRow>
      )}
    </>
  )
  const accountsCard = (
    <>
      <ProxyRows status={proxyStatus} />
      <h4 className="settings-card-sub">{t('In their sections')}</h4>
      <JumpRow
        label="Steam"
        ok={!!steam?.name}
        text={steam?.name ?? (steam?.link ? t('Not checked yet') : t('Not set up'))}
        onClick={() => openSection('games', '.steam-part')}
      />
      <JumpRow
        label={t('Google Calendar')}
        ok={calendar}
        text={calendar ? connectedText() : t('Not connected')}
        onClick={() => openSection('alerts', '.calendar-part')}
      />
      {mail && (
        <JumpRow
          label="Gmail"
          ok={gmailAccounts.length > 0}
          text={gmailAccounts.length === 0 ? t('No account yet')
            : `${plural(gmailAccounts.length, '{n} account', '{n} accounts')}${instant.ok ? ` · ${t('instant mail on')}` : ''}`}
          onClick={() => openSection('mail')}
        />
      )}
    </>
  )
  const lookCard = (
    <>
      <SettingRow label={<>{t('Language')} <Synced /></>}>
        {languageChoice !== undefined && (
          <select value={languageChoice} onChange={(e) => saveLanguageChoice(validChoice(e.target.value))}>
            <option value="device">{t('System language')}</option>
            {/* Each in its own language, so it can be found from the other one */}
            <option value="fr">Français</option>
            <option value="en">English</option>
          </select>
        )}
      </SettingRow>
      <SettingRow label={t('App scaling')} value={percentText(scale)}>
        <RulerSlider
          min={SCALE_MIN}
          max={SCALE_MAX}
          step={5}
          mark={DEFAULTS.scale}
          value={scale}
          aria-label={t('App scaling')}
          onChange={(e) => setScale(Number(e.target.value))}
          onPointerUp={applyScale}
          onKeyUp={applyScale}
          onBlur={applyScale}
        />
      </SettingRow>
      <SettingRow label={t('Animations')}>
        <input type="checkbox" checked={appearance.animations} onChange={(e) => update({ animations: e.target.checked })} />
      </SettingRow>
      {/* A short sign that a sync worked (syncSign.ts); nothing without animations */}
      <SettingRow
        label={
          <>
            {t('Sync sign')}
            <InfoTip label={t('About the sync sign')}>
              {t('Shows after a sync that sent or received changes, and when you click the sync button.')}
            </InfoTip>
          </>
        }
      >
        <span className="sync-sign-controls">
          <button
            className="color-dot-button"
            title={t('Color')}
            aria-label={t('Color')}
            disabled={!appearance.animations || appearance.syncSign === 'off'}
            onClick={(e) => setSyncColorMenu({ x: e.clientX, y: e.clientY })}
          >
            <span className="menu-swatch" style={{ background: `var(--text-${appearance.syncSignColor})` }} />
          </button>
          <select
            value={appearance.syncSign}
            disabled={!appearance.animations}
            onChange={(e) => update({ syncSign: e.target.value as SyncSign })}
          >
            <option value="off">{t('Off')}</option>
            <option value="sweep">{t('Line under the tabs')}</option>
            <option value="edge">{t('Glowing edge')}</option>
          </select>
        </span>
      </SettingRow>
      {tabColors && (
        <>
          <SettingRow label={<>{t('Colored tab icons')} <Synced /></>}>
            <input type="checkbox" checked={tabColors.on} onChange={(e) => saveTabColors({ on: e.target.checked })} />
          </SettingRow>
          <SettingRow label={t('Tab colors')}>
            <span className="tab-color-buttons">
              {colorTabs.map((kind) => (
                <button
                  key={kind}
                  className="tab-color-button"
                  title={tabNames[kind]}
                  aria-label={tabNames[kind]}
                  disabled={!tabColors.on}
                  onClick={(e) => setTabColorMenu({ kind, x: e.clientX, y: e.clientY })}
                >
                  <SpecialIcon kind={kind} size={16} />
                </button>
              ))}
            </span>
          </SettingRow>
        </>
      )}
      {syncColorMenu && (
        <ContextMenu
          x={syncColorMenu.x}
          y={syncColorMenu.y}
          onClose={() => setSyncColorMenu(null)}
          header={{ title: t('Sync sign') }}
          items={colorMenuItems(appearance.syncSignColor, (color) => color && update({ syncSignColor: color }), false)}
        />
      )}
      {tabColorMenu && tabColors && (
        <ContextMenu
          x={tabColorMenu.x}
          y={tabColorMenu.y}
          onClose={() => setTabColorMenu(null)}
          header={{ title: tabNames[tabColorMenu.kind] }}
          items={colorMenuItems(
            tabColors.colors[tabColorMenu.kind],
            (color) => color && saveTabColors({ colors: { ...tabColors.colors, [tabColorMenu.kind]: color } }),
            false,
          )}
        />
      )}
    </>
  )
  const windowCard = isTauri() && (
    <>
      <SettingRow
        label={
          <>
            <X size={13} aria-label={t('Close')} /> {t('hides SyncR in the tray')}
            <InfoTip label={t('About the tray')}>{t('Keeps reminders working. Quit is in the tray menu.')}</InfoTip>
          </>
        }
      >
        <input
          type="checkbox"
          checked={background.closeToTray}
          onChange={(e) => updateBackground({ closeToTray: e.target.checked })}
        />
      </SettingRow>
      <SettingRow
        label={
          <>
            {t('Start with Windows')}
            <InfoTip label={t('About starting with Windows')}>{t('When you sign in to Windows.')}</InfoTip>
          </>
        }
      >
        <input
          type="checkbox"
          checked={autostart ?? false}
          disabled={autostart === null}
          onChange={(e) => toggleAutostart(e.target.checked)}
        />
      </SettingRow>
      <SettingRow
        label={
          <>
            {t('Start hidden in the tray')}
            <InfoTip label={t('About starting hidden')}>{t('When started with Windows. Otherwise the window shows.')}</InfoTip>
          </>
        }
      >
        <input
          type="checkbox"
          checked={background.startHidden}
          disabled={!autostart}
          onChange={(e) => updateBackground({ startHidden: e.target.checked })}
        />
      </SettingRow>
      <SettingRow
        label={
          <>
            {t('Look for updates')}
            <InfoTip label={t('About looking for updates')}>
              {t('Always when SyncR starts. To look now: the button next to Settings, at the bottom of the sidebar.')}
              {/* instant (useInstantStatus above) re-renders this when the signals start or stop */}
              {instant.ok && signalsWork() && ` ${t('Instant updates are on: a new version shows within seconds, so this check runs at most every 6 hours, as a safety net.')}`}
            </InfoTip>
          </>
        }
      >
        <select value={background.updateCheck} onChange={(e) => updateBackground({ updateCheck: Number(e.target.value) })}>
          {updateChoices().map(({ minutes, name }) => (
            <option key={minutes} value={minutes}>
              {name}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow
        label={
          <>
            {t('PIN lock')}
            <InfoTip label={t('About the PIN lock')}>
              {!pinOn && syncReady === false && `${t('Needs sync set up.')} `}
              {t('Asks for a PIN when SyncR starts. Notes, sign-ins and the sync key stay locked until then.')}
            </InfoTip>
          </>
        }
      >
        {pinOn && (
          <button className="setting-button" onClick={() => setPinDialog('change')}>
            {t('Change PIN…')}
          </button>
        )}
        <input
          type="checkbox"
          checked={pinOn}
          disabled={!pinOn && !syncReady}
          onChange={(e) => setPinDialog(e.target.checked ? 'on' : 'off')}
        />
      </SettingRow>
    </>
  )
  // The sidebar's sections, in the user's order (Window, Mail and Hardware: PC only; Video where
  // the Worker allows it), the modules under their heading; Accounts sits at the bottom. off: a
  // module turned off, grayed (Hardware: the widget and the mouse battery both off).
  const sections = [
    { id: 'notes', icon: NotebookPen, name: t('Notes'), content: notesCard },
    { id: 'links', icon: Link, name: t('Links'), content: linksCard },
    { id: 'alerts', icon: Bell, name: t('Alerts'), content: alertsCard },
    { id: 'look', icon: Palette, name: t('Look'), content: lookCard },
    { id: 'window', icon: AppWindow, name: t('Window'), content: windowCard },
    { id: 'mail', icon: Mail, name: t('Mail'), content: (isTauri() || import.meta.env.DEV) && <MailSection />, module: true, off: !mailOn },
    { id: 'video', icon: Video, name: t('Video'), content: videoOn && <VideoSection />, module: true, off: !videoModuleOn },
    { id: 'games', icon: Gamepad2, name: t('Games'), content: <GamesSection proxyReady={proxyStatus.ok} />, module: true, off: !gamesOn },
    { id: 'hardware', icon: Cpu, name: t('Hardware'), content: isTauri() && <HardwareSection />, module: true, off: !hardware.on && !mouseBattery.on },
    { id: 'accounts', icon: Plug, name: t('Accounts'), content: accountsCard },
  ].filter((s) => s.content)
  const firstModule = sections.find((s) => s.module)?.id
  const current = sections.find((s) => s.id === section) ?? sections[0]
  // Phone: the list fills the window; a section opens in its place, with ‹ back to the list
  // While searching, the results take the section's place (phone: the list's, under the box) and
  // no section is lit in the sidebar
  const showList = !narrow || !phoneOpen
  const showNav = showList && !(narrow && searching)
  const showPage = !narrow || phoneOpen || searching
  const lit = !narrow && !searching
  const back = narrow && phoneOpen ? () => setPhoneOpen(false) : null
  const searchBox = <SettingsSearchBox query={query} onQuery={search} inputRef={searchRef} />

  // Check for updates: the icon next to Settings in the sidebar
  const about = (
    <p className="settings-about">
      SyncR{' '}
      {/* Click the version: what's new in it */}
      <button className="version-link" title={t("What's new")} onClick={() => setShowWhatsNew(true)}>
        {`v${__APP_VERSION__}`}
      </button>
      {' '}· {t('by Logiinx')}
    </p>
  )


  return (
    <>
      <Window className="dialog settings sidebar-settings" label={t('Settings')} onClose={onClose} ref={dialogRef}>
        <div className="dialog-head">
          {back ? (
            <button className="settings-back" onClick={back}>
              <ChevronLeft size={18} /> {current.name}
            </button>
          ) : (
            <h2>{t('Settings')}</h2>
          )}
          {!narrow && searchBox}
          <CloseButton onClick={onClose} />
        </div>
        <div className="settings-body">
          {narrow && showList && searchBox}
          {showNav && (
            <nav className="settings-nav" aria-label={t('Settings sections')}>
              {sections.map(({ id, icon: Icon, name, off }) => (
                <Fragment key={id}>
                  {id === firstModule && <h3 className="settings-nav-heading">{t('Modules')}</h3>}
                  <button
                    className={`settings-nav-item${id === current.id && lit ? ' on' : ''}${id === 'accounts' ? ' last' : ''}${off ? ' off' : ''}`}
                    aria-current={id === current.id && lit ? 'page' : undefined}
                    onClick={() => openSection(id)}
                  >
                    <Icon size={15} /> {name}
                  </button>
                </Fragment>
              ))}
              {about}
            </nav>
          )}
          {showPage && (
            <div className="settings-page" ref={pageRef}>
              {searching ? <SettingsResults query={query} sections={sections} /> : current.content}
            </div>
          )}
        </div>
      </Window>
    </>
  )
}

// The section Settings opens on (the last one looked at, this device only)
const SECTION_KEY = 'syncr.settingsSection'

// Google Calendar's state when signed in
const connectedText = () => {
  const name = googleName()
  return name ? t('Connected as {name}', { name }) : t('Connected')
}

// A connection's state in the Accounts card: green when it works, cut with … if long
function Status({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span className={`settings-status${ok ? ' ok' : ''}`} title={text}>
      {text === t('Checking…') && <Spinner size={12} />}
      {text}
    </span>
  )
}

// Shared by all devices (synced through Dropbox); everything else is for this device only
function Synced() {
  return <span className="tag-dim">{t('synced')}</span>
}

// Game search: the address and password of SyncR's IGDB proxy (igdb.ts), synced to all devices.
// The connection is checked by itself (when Settings opens, and shortly after typing stops):
// a green "Connected", or what went wrong.
const CHECK_DELAY = 800 // ms after the last key

// Address + password of the last check that worked, until the app closes (see useProxyStatus)
let lastGoodConnection: string | null = null

// Whether the proxy answers with this address + password: "Connected", or what went wrong.
// Shown from the start, so the dialog doesn't grow when the first result comes in. The saved
// connection loads a moment later: if one worked before, start on "Connected" (corrected below
// if the saved one is different now)
function useProxyStatus(connection: IgdbConnection | null) {
  const [status, setStatus] = useState(() =>
    lastGoodConnection ? { ok: true, text: t('Connected') } : { ok: false, text: t('Waiting for connection…') },
  )
  const language = useLanguage()
  const openedAt = useRef(Date.now())

  useEffect(() => {
    if (!connection) return
    // Not set up: "Waiting for connection…" stays until Settings has been open for a second
    // (a brief flash of it looked jumpy), then "Not set up"
    if (!isComplete(connection)) {
      const wait = Math.max(0, 1000 - (Date.now() - openedAt.current))
      const timer = window.setTimeout(() => setStatus({ ok: false, text: t('Not set up') }), wait)
      return () => window.clearTimeout(timer)
    }
    // Same address and password as the last check that worked: "Connected" right away, and
    // the check below runs quietly (the status only changes if it fails now)
    const key = `${connection.url}\n${connection.password}`
    const knownGood = key === lastGoodConnection
    if (knownGood) setStatus({ ok: true, text: t('Connected') })
    let current = true
    const timer = window.setTimeout(async () => {
      if (!knownGood) setStatus({ ok: false, text: t('Checking…') })
      try {
        await igdb('games', 'fields name; limit 1;', connection)
        lastGoodConnection = key
        if (current) setStatus({ ok: true, text: t('Connected') })
      } catch (error) {
        if (lastGoodConnection === key) lastGoodConnection = null
        if (current) setStatus({ ok: false, text: error instanceof Error ? error.message : String(error) })
      }
    }, CHECK_DELAY)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [connection, language])
  return status
}

// Accounts: the game search proxy's address and password (synced), its check under them (status:
// useProxyStatus, in the dialog, so Games' Steam part follows the same check). Video, Steam and the
// Google sign-ins go through it too.
function ProxyRows({ status }: { status: { ok: boolean; text: string } }) {
  const saved = useConnection()
  const [connection, setConnection] = useState<IgdbConnection | null>(null) // null until loaded
  const [showPassword, setShowPassword] = useState(false)

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
    <>
      <h4 className="settings-card-sub">
        {t('Game search')} <Synced />
        <InfoTip label={t('About the game search proxy')}>
          {t('Your Cloudflare Worker. Game search, Steam, Video and the Google sign-ins (Calendar, Gmail) go through it.')}
        </InfoTip>
      </h4>
      <SettingRow label={t('Proxy address')} className="settings-row-field">
        <input
          type="url"
          placeholder="https://….workers.dev"
          aria-label={t('Proxy address')}
          value={connection?.url ?? ''}
          onChange={(e) => change({ url: e.target.value.trim() })}
          disabled={!connection}
          spellCheck={false}
        />
      </SettingRow>
      <SettingRow label={t('Proxy password')} className="settings-row-field">
        <SecretField
          value={connection?.password ?? ''}
          onChange={(password) => change({ password })}
          disabled={!connection}
          autoComplete="off"
          what={t('password')}
          visible={showPassword}
          onToggle={() => setShowPassword(!showPassword)}
        />
      </SettingRow>
      <RowStatus ok={status.ok} text={status.text} busy={status.text === t('Checking…')} />
    </>
  )
}

// Accounts: a connection set up in another section, its state; a click opens that section
function JumpRow({ label, ok, text, onClick }: { label: string; ok: boolean; text: string; onClick: () => void }) {
  return (
    <button className="settings-row settings-jump" onClick={onClick}>
      <span className="settings-row-label">{label}</span>
      <span className="settings-row-control">
        <Status ok={ok} text={text} />
        <ChevronRight size={15} className="settings-jump-arrow" />
      </span>
    </button>
  )
}

// Alerts → Reminders: Google Calendar sign-in (google.ts), per device. Phone/browser: Connect
// leaves the app for Google's page; the result shows under the cloud button on return. PC app:
// Google's page opens in the browser; the result shows here. Needs the game search proxy.
function CalendarRow() {
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
    ? connectedText()
    : (message ?? (!isComplete(proxy) ? t('Needs the game search proxy (Accounts)') : t('Not connected')))

  async function toggle() {
    setBusy(true)
    setMessage(null)
    try {
      if (connected) await disconnectGoogle()
      else {
        // Phone/browser: leaves the app. PC app: waits here for the sign-in in the browser
        if (isTauri()) setMessage(t('Finish the sign-in in your browser…'))
        const result = await connectGoogle()
        setMessage(result && !result.ok ? result.text : null)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
    setBusy(false)
  }

  return (
    <>
      <SettingRow label={t('Google Calendar')}>
        <button className="setting-button" disabled={busy || (!connected && !isComplete(proxy))} onClick={toggle}>
          {connected ? t('Disconnect') : t('Connect…')}
        </button>
      </SettingRow>
      <RowStatus ok={connected} text={status} busy={busy && !connected && isTauri()} under="button" />
    </>
  )
}

// What dragging an email to one side does (MailDrag.tsx); Read / unread: Mark as read, or as
// unread when it's read already
function MailDragChoice({ value, onChange }: { value: MailDrag; onChange: (value: MailDrag) => void }) {
  const names: Record<MailDrag, string> = {
    read: t('Read / unread'),
    archive: t('Archive'),
    trash: t('Delete'),
    none: t('Nothing'),
  }
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as MailDrag)}>
      {(Object.keys(names) as MailDrag[]).map((choice) => (
        <option key={choice} value={choice}>
          {names[choice]}
        </option>
      ))}
    </select>
  )
}

// How often the PC looks for a new version while it runs (UpdateBanner.tsx; 0: only at start-up)
const updateChoices = () => [
  { minutes: 1, name: t('Every minute') },
  { minutes: 15, name: t('Every 15 minutes') },
  { minutes: 60, name: t('Every hour') },
  { minutes: 360, name: t('Every 6 hours') },
  { minutes: 0, name: t('Only at start-up') },
]

// Email pop-ups fade by themselves after… (0: they stay until closed)
const FADE_CHOICES = [
  { seconds: 0, name: '' },
  { seconds: 10, name: '10 s' },
  { seconds: 30, name: '30 s' },
  { seconds: 60, name: '1 min' },
]

// The sites whose links get a card: typed as "github.com, x.com", saved when leaving the field.
// Emptied: back to the default sites (as the placeholder shows). A text area that wraps and grows
// with its text: scrolling a single line sideways kept the cursor out of view at the end (PC) or
// when the keyboard moved it (Chrome on Android).
function SitesInput({ sites, disabled, onChange }: { sites: string[]; disabled: boolean; onChange: (sites: string[]) => void }) {
  const [text, setText] = useState(sites.join(', '))
  const save = () => {
    // Untouched: nothing saved (the list syncs: an old copy here mustn't replace a newer one)
    if (text === sites.join(', ')) return
    const parsed = parseSites(text)
    const chosen = parsed.length ? parsed : DEFAULT_SITES
    setText(chosen.join(', '))
    onChange(chosen)
  }
  return (
    <textarea
      className="settings-sites"
      rows={1}
      value={text}
      disabled={disabled}
      placeholder={DEFAULT_SITES.join(', ')}
      spellCheck={false}
      aria-label={t('Sites')}
      onChange={(e) => setText(e.target.value.replace(/\s*[\r\n]+\s*/g, ', '))} // pasted lines
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return
        e.preventDefault() // no new line: Enter is done
        e.currentTarget.blur()
      }}
    />
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
            {t(name)}
          </option>
        ))}
      </select>
      <button className="settings-play" title={t('Play')} aria-label={t('Play')} disabled={value === 'none'} onClick={() => playSound(value)}>
        <Play size={13} />
      </button>
    </>
  )
}

const CORNERS: { id: PopupCorner; name: TextKey }[] = [
  { id: 'top-left', name: textKey('Top left') },
  { id: 'top-right', name: textKey('Top right') },
  { id: 'bottom-left', name: textKey('Bottom left') },
  { id: 'bottom-right', name: textKey('Bottom right') },
]

// PC: where the pop-up shows (screen + corner), e.g. on a second screen, away from a game.
// The screens are read from Windows when Settings opens; a chosen screen that isn't plugged
// in is kept, and the pop-up uses the main screen meanwhile. One that Windows renamed is found
// by its place and size (desktop.ts); one that's the main screen by now shows as Main screen.
function PopupPlace({
  background,
  onChange,
}: {
  background: Background
  onChange: (change: Partial<Background>) => void
}) {
  const [monitors, setMonitors] = useState<Monitor[]>([])
  const [main, setMain] = useState<Monitor | null>(null)
  useEffect(() => {
    Promise.all([availableMonitors(), primaryMonitor()])
      .then(([monitors, main]) => {
        setMonitors(monitors)
        setMain(main)
        const change = popupScreenChange(monitors, main, loadBackground())
        if (change) onChange(change)
      })
      .catch((error) => console.error(error))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when Settings opens
  }, [])
  const size = (m: Monitor) => `${m.size.width} × ${m.size.height}`
  const others = monitors.filter((m) => m.name !== main?.name).sort((a, b) => a.position.x - b.position.x)
  const chosen = findPopupScreen(monitors, background)
  const unplugged = background.popupScreen !== null && monitors.length > 0 && !chosen
  const isMain = !chosen || chosen.name === main?.name
  const current = unplugged ? null : isMain ? main : chosen
  // The chosen one without its size (on the row's tooltip), so it fits the dropdown; the others with it
  const screenName = (name: string, screen: Monitor | null) => (!screen || screen === current ? name : `${name} (${size(screen)})`)
  return (
    <>
      <SettingRow
        label={t('Pop-up screen')}
        title={unplugged ? t("The chosen screen isn't plugged in: main screen meanwhile") : current ? size(current) : undefined}
      >
        <select
          value={unplugged ? background.popupScreen! : isMain ? '' : (chosen.name ?? '')}
          onChange={(e) => {
            const picked = others.find((m) => m.name === e.target.value)
            onChange({ popupScreen: picked?.name ?? null, popupScreenSpot: picked ? screenSpot(picked) : null })
          }}
        >
          {unplugged && <option value={background.popupScreen!}>{t('Unplugged screen')}</option>}
          <option value="">
            {screenName(t('Main screen'), main)}
          </option>
          {others.map((screen, i) => (
            <option key={screen.name} value={screen.name ?? ''}>
              {screenName(t('Screen {n}', { n: i + 2 }), screen)}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow label={t('Pop-up corner')}>
        <select value={background.popupCorner} onChange={(e) => onChange({ popupCorner: e.target.value as PopupCorner })}>
          {CORNERS.map(({ id, name }) => (
            <option key={id} value={id}>
              {t(name)}
            </option>
          ))}
        </select>
      </SettingRow>
    </>
  )
}

export default SettingsDialog
