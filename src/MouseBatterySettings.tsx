import { useState } from 'react'
import { X } from 'lucide-react'
import Dialog from './Dialog'
import InfoTip from './InfoTip'
import { ModuleSwitch, SettingRow } from './SettingsCard'
import { clockTime } from './dates'
import { loadBackground } from './desktop'
import { percentText, t } from './i18n'
import { withIcon } from './richText'
import { LOW_LEVELS, saveMouseBattery, useMouseBattery, useMouseBatteryStatus } from './mouseBattery'

// Settings → Mouse battery (a click on the taskbar strip opens it): on or off, what it shows now,
// and the low level (mouseBattery.ts)
export default function MouseBatterySection() {
  const settings = useMouseBattery()
  // Turning it on while ✕ quits SyncR warns once: the battery only shows while SyncR runs
  const [quitWarning, setQuitWarning] = useState(false)
  function toggle(on: boolean) {
    const warn = on && !settings.warned && !loadBackground().closeToTray
    saveMouseBattery(warn ? { on, warned: true } : { on })
    if (warn) setQuitWarning(true)
  }
  const status = useMouseBatteryStatus(settings.on)
  const last = status?.last
  const battery = !last
    ? status ? t('No answer yet') : '…'
    : last.charging && status?.answering ? t('{percent}%, charging', { percent: last.percent }) : percentText(last.percent)

  return (
    <>
      <ModuleSwitch
        name={t('Mouse battery')}
        aboutLabel={t('About the mouse battery')}
        about={t('Shows the battery of a Teevolution Terra Pro mouse (8K receiver) in the taskbar, next to the clock.')}
        on={settings.on}
        onChange={toggle}
      />
      <fieldset className="settings-part" disabled={!settings.on}>
        <SettingRow
          label={
            <>
              {t('Battery')}
              <InfoTip label={t('About the battery check')}>
                {t('Asked every minute, through the mouse’s 8K receiver, and shown in the taskbar left of the icons next to the clock. While the mouse sleeps, the last answer stays.')}
              </InfoTip>
            </>
          }
        >
          <span className={`settings-status${status?.answering ? ' ok' : ''}`}>{settings.on ? battery : '—'}</span>
        </SettingRow>
        {last && settings.on && (
          <SettingRow label={t('Last answer')}>
            <span className="settings-status">
              {status?.answering ? clockTime(last.at) : t('{time}, asleep or out of reach', { time: clockTime(last.at) })}
            </span>
          </SettingRow>
        )}
        <SettingRow
          label={
            <>
              {t('Low battery')}
              <InfoTip label={t('About low battery')}>{t('At or below this level, the number turns red and the pop-up warns you once, until the mouse charges above it again.')}</InfoTip>
            </>
          }
        >
          <select value={settings.low} onChange={(e) => saveMouseBattery({ low: Number(e.target.value) })}>
            {LOW_LEVELS.map((level) => (
              <option key={level} value={level}>
                {percentText(level)}
              </option>
            ))}
          </select>
        </SettingRow>
      </fieldset>
      {quitWarning && (
        <Dialog
          request={{
            title: t('The battery only shows while SyncR runs'),
            message: withIcon(t('{close} quits SyncR, and the battery goes with it. To keep it, turn on “{close} hides SyncR in the tray” in Window.'), 'close', <X size={13} aria-label={t('Close')} />),
            confirmLabel: 'OK',
            noCancel: true,
            onConfirm: () => {},
          }}
          onClose={() => {
            setQuitWarning(false)
          }}
        />
      )}
    </>
  )
}
