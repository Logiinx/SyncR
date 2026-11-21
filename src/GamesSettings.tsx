import { ModuleSwitch, SettingRow } from './SettingsCard'
import { setModuleOn, useModuleOn } from './modules'
import { t } from './i18n'
import { setJoinTimes, setPricesRight, setShortPlaytime, useJoinTimes, usePricesRight, useShortPlaytime, type ShortPlaytime } from './gamesOptions'

// Settings → Games (also My games' ⚙️): Games on or off (modules.ts), how My games shows. This
// device only (gamesOptions.ts).
export default function GamesSection() {
  const on = useModuleOn('games')
  const playtime = useShortPlaytime()
  const joinTimes = useJoinTimes()
  const pricesRight = usePricesRight()
  return (
    <>
      <ModuleSwitch
        name={t('Games')}
        aboutLabel={t('About the Games module')}
        about={t('Your game lists in a Games tab, with release days, prices and Steam playtimes kept up to date. Off: the tab closes and nothing is checked. This device only.')}
        on={on}
        onChange={(next) => setModuleOn('games', next)}
      />
      <fieldset className="settings-part" disabled={!on}>
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
      </fieldset>
    </>
  )
}
