import { Eye, Mouse } from 'lucide-react'
import CloseButton from './CloseButton'
import Window from './Window'
import InfoTip from './InfoTip'
import { SettingRow, SettingsCard } from './SettingsCard'
import { clockTime } from './dates'
import { t } from './i18n'
import { LOW_LEVELS, saveMouseBattery, useMouseBattery, useMouseBatteryStatus } from './mouseBattery'

// Settings → Modules → Mouse battery → Open…: what it shows now, and how (mouseBattery.ts)
export default function MouseBatterySettings({ onClose }: { onClose: () => void }) {
  const settings = useMouseBattery()
  const status = useMouseBatteryStatus(settings.on)
  const last = status?.last
  const battery = !last
    ? status ? t('No answer yet') : '…'
    : last.charging ? t('{percent}%, charging', { percent: last.percent }) : t('{percent}%', { percent: last.percent })

  return (
    <Window className="dialog settings module-settings" label={t('Mouse battery')} onClose={onClose}>
      <div className="dialog-head">
        <h2>{t('Mouse battery')}</h2>
        <CloseButton onClick={onClose} />
      </div>
      <div className="settings-cards">
        <SettingsCard icon={Mouse} title={t('Teevolution Terra Pro')}>
          <SettingRow
            label={
              <>
                {t('Battery')}
                <InfoTip label={t('About the battery check')}>
                  {t('Asked every minute, through the mouse’s 8K receiver. While the mouse sleeps, the last answer stays.')}
                </InfoTip>
              </>
            }
          >
            <span className={`settings-status${status?.answering ? ' ok' : ''}`}>{battery}</span>
          </SettingRow>
          {last && (
            <SettingRow label={t('Last answer')}>
              <span className="settings-status">
                {status?.answering ? clockTime(last.at) : t('{time}, asleep or out of reach', { time: clockTime(last.at) })}
              </span>
            </SettingRow>
          )}
        </SettingsCard>
        <SettingsCard icon={Eye} title={t('Show')}>
          <SettingRow
            label={
              <>
                {t('Tray icon')}
                <InfoTip label={t('About the tray icon')}>{t('Its own icon next to the clock, with the number in it.')}</InfoTip>
              </>
            }
          >
            <input type="checkbox" checked={settings.tray} onChange={(e) => saveMouseBattery({ tray: e.target.checked })} />
          </SettingRow>
          <SettingRow
            label={
              <>
                {t('Low battery')}
                <InfoTip label={t('About low battery')}>{t('At or below this level, the number turns red.')}</InfoTip>
              </>
            }
          >
            <select value={settings.low} onChange={(e) => saveMouseBattery({ low: Number(e.target.value) })}>
              {LOW_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {t('{percent}%', { percent: level })}
                </option>
              ))}
            </select>
          </SettingRow>
        </SettingsCard>
      </div>
    </Window>
  )
}
