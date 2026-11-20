import { useState } from 'react'
import { AppWindow, Cpu, Gauge, Gpu, MemoryStick } from 'lucide-react'
import CloseButton from './CloseButton'
import Window from './Window'
import InfoTip from './InfoTip'
import { SettingRow, SettingsCard } from './SettingsCard'
import { decimal, percentText, t } from './i18n'
import {
  BACKGROUNDS,
  CLICK_THROUGH,
  FRAMES,
  type HardwareSettings as HardwareSettingsType,
  type HelperState,
  type Sensor,
  SIZES,
  SPEEDS,
  THEMES,
  clickThroughAbout,
  removeHelper,
  saveHardware,
  setUpHelper,
  shortCpuName,
  shortGpuName,
  useHardware,
  useHardwareReadings,
  sensorLabel,
  valueText,
} from './hardware'

// Settings → Modules → Hardware → Open…: every reading as it is now, which ones the widget shows,
// and how often they're read (hardware.ts)
export default function HardwareSettings({ onClose }: { onClose: () => void }) {
  const settings = useHardware()
  const readings = useHardwareReadings(settings.on)
  const [asking, setAsking] = useState(false) // an admin prompt is open
  const [failed, setFailed] = useState(false) // the last set-up didn't work (a failed removal: Remove stays)
  const helper = readings?.cpuTempState ?? null

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
    <SettingRow key={sensor} label={sensorLabel(sensor)} value={sensor === 'cpuTemp' ? helperText(helper, failed) : undefined}>
      {sensor === 'cpuTemp' && setUp ? (
        <button className="setting-button" title={helperAbout()} disabled={asking} onClick={() => askAdmin(true)}>
          {setUp}
        </button>
      ) : (
        <span className="settings-status">{readings ? (valueText(sensor, readings) ?? '—') : '…'}</span>
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
    <Window className="dialog settings module-settings" label={t('Hardware')} onClose={onClose}>
      <div className="dialog-head">
        <h2>{t('Hardware')}</h2>
        <CloseButton onClick={onClose} />
      </div>
      <div className="settings-cards">
        <SettingsCard icon={Gauge} title={t('Readings')}>
          <SettingRow
            label={
              <>
                {t('Update every')}
                <InfoTip label={t('About the readings')}>
                  {t('Only the readings ticked below are read, except while this window is open: it shows them all.')}
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
        </SettingsCard>
        <SettingsCard icon={AppWindow} title={t('Widget')}>
          <SettingRow label={t('Always on top')}>
            <input type="checkbox" checked={settings.onTop} onChange={(e) => saveHardware({ onTop: e.target.checked })} />
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
        </SettingsCard>
        <SettingsCard icon={Cpu} title={readings?.cpuName ? shortCpuName(readings.cpuName) : t('CPU')}>
          {helper !== 'unsupported' && row('cpuTemp')}
          {row('cpuLoad')}
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
        </SettingsCard>
        <SettingsCard icon={Gpu} title={readings?.gpuName ? shortGpuName(readings.gpuName) : t('GPU')}>
          {row('gpuTemp')}
          {readings?.gpuMemTemp !== null && row('gpuMemTemp')}
          {row('gpuLoad')}
          {row('gpuClock')}
          {row('gpuMemClock')}
          {row('gpuFan')}
        </SettingsCard>
        <SettingsCard icon={MemoryStick} title={t('Memory')}>
          {row('ram')}
        </SettingsCard>
      </div>
    </Window>
  )
}

const helperAbout = () =>
  t('The CPU temperature needs admin rights, which SyncR doesn’t have. This small helper has them: it starts with Windows and only reads the temperature when SyncR asks. Turning the module off leaves it resting.')

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
