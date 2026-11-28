import { useState } from 'react'
import InfoTip from './InfoTip'
import { ModuleSwitch, SettingRow } from './SettingsCard'
import { decimal, percentText, t } from './i18n'
import {
  BACKGROUNDS,
  CLICK_THROUGH,
  FRAMES,
  HOT_MARGIN,
  type HardwareSettings as HardwareSettingsType,
  type HelperState,
  type HotSensor,
  type Sensor,
  LOOKS,
  SIZES,
  SPEEDS,
  THEMES,
  clickThroughAbout,
  fullScreenAbout,
  groupName,
  heatLevel,
  hasMemTemp,
  isPeakSensor,
  peakText,
  peaksAbout,
  removeHelper,
  resetPeaks,
  saveHardware,
  setUpHelper,
  toggleHardware,
  useHardware,
  useHardwareReadings,
  usePeaks,
  sensorLabel,
  valueText,
} from './hardware'

// Settings → Hardware: the widget on or off, every reading as it is now, which ones the widget
// shows, and how often they're read (hardware.ts); then the mouse battery
export default function HardwareSection() {
  const settings = useHardware()
  const readings = useHardwareReadings(settings.on)
  const [asking, setAsking] = useState(false) // an admin prompt is open
  const [failed, setFailed] = useState(false) // the last set-up didn't work (a failed removal: Remove stays)
  const helper = readings?.cpuTempState ?? null
  const memTemp = hasMemTemp()
  const peaks = usePeaks()

  // One admin prompt; the readings then show the new state
  const askAdmin = (setUp: boolean) => {
    setAsking(true)
    setFailed(false)
    void (setUp ? setUpHelper() : removeHelper()).then((result) => {
      setAsking(false)
      setFailed(setUp && result === 'failed')
    })
  }
  const setUp = helperButton(helper)

  // One reading: its name, its value now, and whether the widget shows it. The CPU temperature
  // needs the admin helper: why it's missing, next to its name, and the button that fixes it.
  const row = (sensor: Sensor) => (
    <SettingRow
      key={sensor}
      label={sensorLabel(sensor)}
      value={(sensor === 'cpuTemp' || sensor === 'cpuPower' ? helperText(helper, failed) : undefined) ?? (isPeakSensor(sensor) ? peakText(sensor, peaks) : undefined)}
    >
      {sensor === 'cpuTemp' && setUp ? (
        <button className="setting-button" title={helperAbout()} disabled={asking} onClick={() => askAdmin(true)}>
          {setUp}
        </button>
      ) : (
        <span className={`settings-status${HEAT_CLASS[heatLevel(sensor)] ?? ''}`}>{readings ? (valueText(sensor, readings) ?? '—') : '…'}</span>
      )}
      <input
        type="checkbox"
        aria-label={t('Show in the widget')}
        title={t('Show in the widget')}
        checked={settings.shown.includes(sensor)}
        onChange={(e) =>
          saveHardware({ shown: e.target.checked ? [...settings.shown, sensor] : settings.shown.filter((s) => s !== sensor) })
        }
      />
    </SettingRow>
  )

  return (
    <>
      <ModuleSwitch
        name={t('Hardware widget')}
        aboutLabel={t('About the hardware module')}
        about={t('Shows your CPU and GPU temperatures, loads, power, clocks, fan and memory in a small widget on your desktop.')}
        on={settings.on}
        onChange={toggleHardware}
      />
      {/* Off: everything about the widget grayed */}
      <fieldset className="settings-part" disabled={!settings.on}>
        <h4 className="settings-card-sub">{t('Readings')}</h4>
        <SettingRow
          label={
            <>
              {t('Update every')}
              <InfoTip label={t('About the readings')}>
                {t('Only the readings ticked below are read, except while Settings shows them: then they all are.')}
              </InfoTip>
            </>
          }
        >
          <select value={settings.everyMs} onChange={(e) => saveHardware({ everyMs: Number(e.target.value) })}>
            {SPEEDS.map((ms) => (
              <option key={ms} value={ms}>
                {t('{n} s', { n: decimal(ms / 1000, ms < 1000 ? 1 : 0) })}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow
          label={
            <>
              {t('Peaks')}
              <InfoTip label={t('About peaks')}>{peaksAbout()}</InfoTip>
            </>
          }
        >
          <button className="setting-button" disabled={Object.keys(peaks).length === 0} onClick={resetPeaks}>
            {t('Reset')}
          </button>
        </SettingRow>
        <h4 className="settings-card-sub">{t('Widget')}</h4>
        <SettingRow label={t('Always on top')}>
          <input type="checkbox" checked={settings.onTop} onChange={(e) => saveHardware({ onTop: e.target.checked })} />
        </SettingRow>
        <SettingRow
          label={
            <>
              {t('Hide during full screen')}
              <InfoTip label={t('About hiding during full screen')}>{fullScreenAbout()}</InfoTip>
            </>
          }
        >
          <input type="checkbox" checked={settings.hideFullScreen} disabled={!settings.onTop} onChange={(e) => saveHardware({ hideFullScreen: e.target.checked })} />
        </SettingRow>
        <SettingRow label={t('Lock position and size')}>
          <input type="checkbox" checked={settings.locked} onChange={(e) => saveHardware({ locked: e.target.checked })} />
        </SettingRow>
        <SettingRow
          label={
            <>
              {t('Click-through')}
              <InfoTip label={t('About click-through')}>{clickThroughAbout()}</InfoTip>
            </>
          }
        >
          <select
            value={settings.clickThrough}
            onChange={(e) => saveHardware({ clickThrough: e.target.value as HardwareSettingsType['clickThrough'] })}
          >
            {CLICK_THROUGH.map(([clickThrough, label]) => (
              <option key={clickThrough} value={clickThrough}>{label()}</option>
            ))}
          </select>
        </SettingRow>
        <SettingRow label={t('Temperatures in')}>
          <select value={settings.fahrenheit ? 'f' : 'c'} onChange={(e) => saveHardware({ fahrenheit: e.target.value === 'f' })}>
            <option value="c">{t('Celsius (°C)')}</option>
            <option value="f">{t('Fahrenheit (°F)')}</option>
          </select>
        </SettingRow>
        <SettingRow label={t('Look')}>
          <select value={settings.look} onChange={(e) => saveHardware({ look: e.target.value as HardwareSettingsType['look'] })}>
            {LOOKS.map(([look, label]) => (
              <option key={look} value={look}>{label()}</option>
            ))}
          </select>
        </SettingRow>
        <SettingRow label={t('Theme')}>
          <select value={settings.theme} onChange={(e) => saveHardware({ theme: e.target.value as HardwareSettingsType['theme'] })}>
            {THEMES.map(([theme, label]) => (
              <option key={theme} value={theme}>{label()}</option>
            ))}
          </select>
        </SettingRow>
        <SettingRow label={t('Frame')}>
          <select value={settings.frame} onChange={(e) => saveHardware({ frame: e.target.value as HardwareSettingsType['frame'] })}>
            {FRAMES.map(([frame, label]) => (
              <option key={frame} value={frame}>{label()}</option>
            ))}
          </select>
        </SettingRow>
        <SettingRow label={t('Background')}>
          <select value={settings.background} onChange={(e) => saveHardware({ background: Number(e.target.value) })}>
            {BACKGROUNDS.map((background) => (
              <option key={background} value={background}>{percentText(background)}</option>
            ))}
          </select>
        </SettingRow>
        <SettingRow label={t('Size')}>
          <select value={settings.size} onChange={(e) => saveHardware({ size: Number(e.target.value) })}>
            {SIZES.map((size) => (
              <option key={size} value={size}>{percentText(size)}</option>
            ))}
          </select>
        </SettingRow>
        <h4 className="settings-card-sub">{t('Hot colors')}</h4>
        <SettingRow
          label={
            <>
              {t('Show hot colors')}
              <InfoTip label={t('About hot colors')}>
                {t('A temperature turns orange from its first limit and red from its second. Its color goes away once it’s {n} under that limit, so it doesn’t blink.', {
                  n: settings.fahrenheit ? t('{n} °F', { n: decimal((HOT_MARGIN * 9) / 5, 0) }) : t('{n} °C', { n: decimal(HOT_MARGIN, 0) }),
                })}
              </InfoTip>
            </>
          }
        >
          <input type="checkbox" checked={settings.hot} onChange={(e) => saveHardware({ hot: e.target.checked })} />
        </SettingRow>
        <LimitsRow sensor="cpuTemp" label={groupName('cpu')} settings={settings} />
        <LimitsRow sensor="gpuTemp" label={groupName('gpu')} settings={settings} />
        {memTemp && <LimitsRow sensor="gpuMemTemp" label={t('GPU memory')} settings={settings} />}
        <h4 className="settings-card-sub">{groupName('cpu', readings)}</h4>
        {helper !== 'unsupported' && row('cpuTemp')}
        {row('cpuLoad')}
        {helper !== 'unsupported' && row('cpuPower')}
        {row('cpuClock')}
        {(helper === 'ok' || helper === 'notRunning' || helper === 'outdated' || helper === 'failed') && (
          <SettingRow
            label={
              <>
                {t('Admin helper')}
                <InfoTip label={t('About the admin helper')}>
                  {helperAbout()}
                </InfoTip>
              </>
            }
          >
            <button className="setting-button" disabled={asking} onClick={() => askAdmin(false)}>
              {t('Remove')}
            </button>
          </SettingRow>
        )}
        <h4 className="settings-card-sub">{groupName('gpu', readings)}</h4>
        {row('gpuTemp')}
        {memTemp && row('gpuMemTemp')}
        {row('gpuLoad')}
        {row('gpuPower')}
        {row('gpuClock')}
        {row('gpuMemClock')}
        {row('gpuMemUsed')}
        {row('gpuFan')}
        <h4 className="settings-card-sub">{groupName('memory')}</h4>
        {row('ram')}
      </fieldset>
    </>
  )
}

const HEAT_CLASS = ['', ' warm', ' hot']

// A temperature's two limits (orange, red), in the unit chosen; saved in °C when the field is left
// or Enter is pressed (saving each key would flash the widget red while typing "85"). Orange must
// stay under red: a limit that would cross the other one isn't saved.
function LimitsRow({ sensor, label, settings }: { sensor: HotSensor; label: string; settings: HardwareSettingsType }) {
  const limits = settings.limits[sensor]
  const shown = (celsius: number) => String(Math.round(settings.fahrenheit ? (celsius * 9) / 5 + 32 : celsius))
  const field = (index: 0 | 1) => (
    <LimitField
      key={`${index}-${settings.fahrenheit}`}
      saved={shown(limits[index])}
      className={index === 0 ? 'warm' : 'hot'}
      label={index === 0 ? t('Orange from') : t('Red from')}
      unit={settings.fahrenheit ? '°F' : '°C'} // i18n-ok
      disabled={!settings.hot}
      onSave={(n) => {
        const celsius = settings.fahrenheit ? ((n - 32) * 5) / 9 : n
        const next: [number, number] = [...limits]
        next[index] = Math.round(celsius * 10) / 10
        if (next[0] >= next[1]) return false
        saveHardware({ limits: { ...settings.limits, [sensor]: next } })
        return true
      }}
    />
  )
  return (
    <SettingRow label={label}>
      {field(0)}
      {field(1)}
    </SettingRow>
  )
}

function LimitField(props: { saved: string; className: string; label: string; unit: string; disabled: boolean; onSave: (n: number) => boolean }) {
  const [text, setText] = useState(props.saved)
  const [before, setBefore] = useState(props.saved)
  if (before !== props.saved) {
    setBefore(props.saved)
    setText(props.saved)
  }
  // Only whole degrees from 0 to 250 (any unit), that onSave accepts; anything else goes back to
  // the saved limit
  const save = () => {
    const n = Number(text.trim())
    const ok = text.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= 250
    if (ok && String(n) !== props.saved && props.onSave(n)) return
    setText(props.saved)
  }
  return (
    <span className={`settings-limit ${props.className}`} title={props.label}>
      {/* No min, max or step: the browser would add its own arrows and bubbles; save() checks it */}
      <input
        type="text"
        inputMode="numeric"
        aria-label={`${props.label} (${props.unit})`}
        value={text}
        disabled={props.disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape' && text !== props.saved) {
            e.stopPropagation() // only undoes the typing, the window stays
            setText(props.saved)
          }
        }}
      />
      <span className="settings-limit-unit">{props.unit}</span>
    </span>
  )
}

const helperAbout = () =>
  t('The CPU temperature and power need admin rights, which SyncR doesn’t have. This small helper has them: it starts with Windows and only reads them when SyncR asks. Turning the module off leaves it resting.')

// The button the CPU temperature needs, if any
function helperButton(state: HelperState | null) {
  if (state === 'noHelper') return t('Set up')
  if (state === 'notRunning') return t('Start')
  if (state === 'outdated') return t('Update')
  return null
}

// Why the CPU temperature is missing (dim, next to its name)
function helperText(state: HelperState | null, failed: boolean) {
  if (failed && state !== 'ok') return t('setup failed')
  if (state === 'noPawnio') return t('needs PawnIO')
  if (state === 'noHelper') return t('needs the helper')
  if (state === 'notRunning') return t('helper stopped')
  if (state === 'outdated') return t('helper out of date')
  return undefined
}
