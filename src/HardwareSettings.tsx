import { Cpu, Gauge, Gpu, MemoryStick } from 'lucide-react'
import CloseButton from './CloseButton'
import Window from './Window'
import InfoTip from './InfoTip'
import { SettingRow, SettingsCard } from './SettingsCard'
import { decimal, percentText, t } from './i18n'
import { type HardwareReadings, type Sensor, SPEEDS, saveHardware, shortCpuName, shortGpuName, useHardware, useHardwareReadings } from './hardware'

const GB = 1024 ** 3 // like Task Manager

// Settings → Modules → Hardware → Open…: every reading as it is now, which ones the widget shows,
// and how often they're read (hardware.ts)
export default function HardwareSettings({ onClose }: { onClose: () => void }) {
  const settings = useHardware()
  const readings = useHardwareReadings(settings.on)

  // One reading: its name, its value now, and whether the widget shows it
  const row = (sensor: Sensor, label: string) => (
    <SettingRow key={sensor} label={label}>
      <span className="settings-status">{readings ? valueText(sensor, readings) : '…'}</span>
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
        <SettingsCard icon={Cpu} title={readings?.cpuName ? shortCpuName(readings.cpuName) : t('CPU')}>
          {row('cpuLoad', t('Load'))}
          {row('cpuClock', t('Clock'))}
        </SettingsCard>
        <SettingsCard icon={Gpu} title={readings?.gpuName ? shortGpuName(readings.gpuName) : t('GPU')}>
          {row('gpuTemp', t('Temperature'))}
          {row('gpuLoad', t('Load'))}
          {row('gpuClock', t('Clock'))}
          {row('gpuMemClock', t('Memory clock'))}
          {row('gpuFan', t('Fan'))}
        </SettingsCard>
        <SettingsCard icon={MemoryStick} title={t('Memory')}>
          {row('ram', t('RAM used'))}
        </SettingsCard>
      </div>
    </Window>
  )
}

// A reading as text, or a dash when this PC can't give it
function valueText(sensor: Sensor, r: HardwareReadings) {
  const none = '—' // i18n-ok
  const mhz = (n: number | null) => (n === null ? none : t('{n} MHz', { n: decimal(n, 0) }))
  const percent = (n: number | null) => (n === null ? none : percentText(Math.round(n)))
  switch (sensor) {
    case 'cpuLoad':
      return percent(r.cpuLoad)
    case 'cpuClock':
      return mhz(r.cpuClock)
    case 'gpuTemp':
      return r.gpuTemp === null ? none : t('{n} °C', { n: decimal(r.gpuTemp, 1) })
    case 'gpuLoad':
      return percent(r.gpuLoad)
    case 'gpuClock':
      return mhz(r.gpuClock)
    case 'gpuMemClock':
      return mhz(r.gpuMemClock)
    case 'gpuFan':
      if (r.gpuFan === null) return none
      return r.gpuFanRpm === null ? percent(r.gpuFan) : t('{percent}% · {rpm} RPM', { percent: Math.round(r.gpuFan), rpm: decimal(r.gpuFanRpm, 0) })
    case 'ram':
      if (r.ramUsed === null || r.ramTotal === null) return none
      return t('{used} / {total} GB', { used: decimal(r.ramUsed / GB, 1), total: decimal(r.ramTotal / GB, 1) })
  }
}
