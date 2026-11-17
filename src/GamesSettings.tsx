import { Gamepad2 } from 'lucide-react'
import CloseButton from './CloseButton'
import Window from './Window'
import { SettingRow, SettingsCard } from './SettingsCard'
import { t } from './i18n'
import { setJoinTimes, setShortPlaytime, useJoinTimes, useShortPlaytime, type ShortPlaytime } from './gamesOptions'

// The ⚙️ of My games: Settings' cards, like Video settings. This device only (gamesOptions.ts).
export default function GamesSettings({ onClose }: { onClose: () => void }) {
  const playtime = useShortPlaytime()
  const joinTimes = useJoinTimes()
  return (
    <Window className="dialog settings games-settings" label={t('Games settings')} onClose={onClose}>
      <div className="dialog-head">
        <h2>{t('Games settings')}</h2>
        <CloseButton onClick={onClose} />
      </div>
      <div className="settings-cards">
        <SettingsCard icon={Gamepad2} title={t('My games')}>
          <SettingRow label={t('HowLongToBeat time')} title={t('On the tiles, list rows and Playing cards. A game’s window always shows all of them.')}>
            <select value={playtime} onChange={(e) => setShortPlaytime(e.target.value as ShortPlaytime)}>
              <option value="off">{t('Off')}</option>
              <option value="main">{t('Main story')}</option>
              <option value="plus">{t('Main + extras')}</option>
              <option value="full">{t('Everything (100%)')}</option>
            </select>
          </SettingRow>
          <SettingRow
            label={t('Join hours played and HowLongToBeat time')}
            title={t('On Playing cards: “42 h / 52 h” instead of “42 h played · 52 h”')}
          >
            <input type="checkbox" checked={joinTimes} onChange={(e) => setJoinTimes(e.target.checked)} />
          </SettingRow>
        </SettingsCard>
      </div>
    </Window>
  )
}
