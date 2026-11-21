import { SettingRow } from './SettingsCard'
import { t } from './i18n'
import { setJoinTimes, setPricesRight, setShortPlaytime, useJoinTimes, usePricesRight, useShortPlaytime, type ShortPlaytime } from './gamesOptions'

// Settings → Games (also My games' ⚙️): how My games shows. This device only (gamesOptions.ts).
export default function GamesSection() {
  const playtime = useShortPlaytime()
  const joinTimes = useJoinTimes()
  const pricesRight = usePricesRight()
  return (
    <>
      <h4 className="settings-card-sub">{t('My games')}</h4>
      <SettingRow label={t('HowLongToBeat time')} title={t('On the tiles, list rows and Playing cards. A game’s window always shows all of them.')}>
        <select value={playtime} onChange={(e) => setShortPlaytime(e.target.value as ShortPlaytime)}>
          <option value="off">{t('Off')}</option>
          <option value="main">{t('Main story')}</option>
          <option value="plus">{t('Main + extras')}</option>
          <option value="full">{t('Everything (100%)')}</option>
        </select>
      </SettingRow>
      {/* Nothing to join without the HowLongToBeat time (user: hidden, not grayed) */}
      {playtime !== 'off' && (
        <SettingRow
          label={t('Join hours played and HowLongToBeat time')}
          title={t('On Playing cards: “42 h / 52 h” instead of “42 h played · 52 h”')}
        >
          <input type="checkbox" checked={joinTimes} onChange={(e) => setJoinTimes(e.target.checked)} />
        </SettingRow>
      )}
      <SettingRow
        label={t('Prices on the right of covers')}
        title={t('Covers with prices: Steam and key prices stacked on the right, the HowLongToBeat time under the year. Tiles too narrow for it keep the usual layout.')}
      >
        <input type="checkbox" checked={pricesRight} onChange={(e) => setPricesRight(e.target.checked)} />
      </SettingRow>
    </>
  )
}
