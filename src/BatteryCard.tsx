import { percentText, t } from './i18n'
import { Check, Mouse } from 'lucide-react'
import CardBar from './CardBar'
import { formatDue } from './reminders'
import type { LowAlert } from './mouseBattery'

// The mouse battery's low warning in the desktop pop-up (mouseBattery.ts decides when), between
// the reminders and the emails. The same card as an email's: a red strip (like the taskbar's red
// number), when + which mouse, the percent. A click on the text opens the Mouse battery window;
// Done (the card bar's solid blue button) closes it. It can fade like an email (ReminderPopup.tsx).
export function BatteryCard({ alert, fading, onOpen, onDone }: {
  alert: LowAlert
  fading: boolean
  onOpen: () => void
  onDone: () => void
}) {
  return (
    <div className={`reminder-alert bar-card${fading ? ' fading' : ''}`} style={{ borderLeftColor: 'var(--text-red)' }}>
      <button className="reminder-alert-body" onClick={onOpen} title={t('Mouse battery')}>
        <span className="reminder-alert-due">
          <Mouse size={12} /> {formatDue(alert.at)} · {t('Teevolution Terra Pro')}
        </span>
        <span className="reminder-alert-text battery-percent">{t('Mouse battery low: {percent}', { percent: percentText(alert.percent) })}</span>
      </button>
      <CardBar buttons={[{ label: t('Done'), icon: <Check size={15} />, filled: true, onClick: onDone }]} />
    </div>
  )
}
