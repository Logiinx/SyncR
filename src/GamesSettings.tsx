import { useEffect, useState } from 'react'
import { ModuleSwitch, RowStatus, SettingRow } from './SettingsCard'
import InfoTip from './InfoTip'
import { richText } from './richText'
import { checkSteamProfile, followSteam, saveSteamFollow, saveSteamProfile, useSteamFollow, useSteamProfile, type SteamProfile } from './steam'
import { setModuleOn, useModuleOn } from './modules'
import { plural, t, useLanguage } from './i18n'
import { setJoinTimes, setPricesRight, setShortPlaytime, useJoinTimes, usePricesRight, useShortPlaytime, type ShortPlaytime } from './gamesOptions'

// Settings → Games (also My games' ⚙️): Games on or off (modules.ts), how My games shows (this
// device only, gamesOptions.ts), the Steam profile. proxyReady: the game search proxy answers
// (Settings → Accounts).
export default function GamesSection({ proxyReady }: { proxyReady: boolean }) {
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
        <h4 className="settings-card-sub steam-part">Steam</h4>
        <SteamPart proxyReady={proxyReady} />
      </fieldset>
    </>
  )
}

// Your Steam profile (steam.ts), synced: checked like the proxy, shortly after typing stops and
// when Settings opens. Its id and name are saved once found.
const CHECK_DELAY = 800 // ms after the last key
function SteamPart({ proxyReady }: { proxyReady: boolean }) {
  const saved = useSteamProfile()
  const follow = useSteamFollow()
  const [profile, setProfile] = useState<SteamProfile | null>(null) // null until loaded
  const [status, setStatus] = useState({ ok: false, text: '' })
  const language = useLanguage()

  useEffect(() => {
    if (saved) setProfile((current) => current ?? saved)
  }, [saved])

  useEffect(() => {
    if (!profile) return
    if (!profile.link.trim()) return setStatus({ ok: false, text: t('Not set up') })
    if (!proxyReady) return setStatus({ ok: false, text: t('Needs the game search proxy (Accounts)') })
    if (profile.name) setStatus({ ok: true, text: t('Connected as {name}', { name: profile.name }) })
    let current = true
    const timer = window.setTimeout(async () => {
      if (!profile.name) setStatus({ ok: false, text: t('Checking…') })
      try {
        const found = await checkSteamProfile(profile.link)
        const name = found.name ?? found.steamId
        if (!current) return // another link was typed meanwhile: don't save over it
        if (found.steamId !== profile.steamId || name !== profile.name) {
          await saveSteamProfile({ link: profile.link, steamId: found.steamId, name })
        }
        if (found.games === null) setStatus({ ok: false, text: t('{name}: game details are private (Steam → Profile → Privacy)', { name }) })
        else setStatus({ ok: true, text: plural(found.games, 'Connected as {name} · {n} game', 'Connected as {name} · {n} games', { name }) })
      } catch (error) {
        if (current) setStatus({ ok: false, text: error instanceof Error ? error.message : String(error) })
      }
    }, CHECK_DELAY)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.link, proxyReady, language])

  return (
    <>
      <SettingRow label={t('Steam profile')} className="settings-row-field">
        <input
          type="url"
          placeholder="https://steamcommunity.com/id/…"
          aria-label={t('Steam profile')}
          value={profile?.link ?? ''}
          onChange={(e) => {
            // A new link: the id and name come with its check
            const next = { link: e.target.value.trim() }
            setProfile(next)
            saveSteamProfile(next)
          }}
          disabled={!profile}
          spellCheck={false}
        />
      </SettingRow>
      {status.text && <RowStatus ok={status.ok} text={status.text} busy={status.text === t('Checking…')} />}
      {/* Games move by themselves (steam.ts followSteam); checked right away when switched on */}
      <SettingRow
        label={
          <>
            {t('Follow my Steam account')}
            <InfoTip label={t('How Follow my Steam account works')}>
              {t('Moves games for you, based on your Steam account (checked about every 30 minutes):')}
              <ul>
                <li>{richText(t('A **To buy** game you own on Steam → **To play › Not started**'))}</li>
                <li>{richText(t('A **Not started** game you play for 1 hour on Steam → **Playing**'))}</li>
              </ul>
              {t('Each move shows a line at the top of Games. Nothing else moves, and you can always move a game back.')}
            </InfoTip>
          </>
        }
      >
        <input
          type="checkbox"
          checked={!!follow}
          disabled={follow === undefined}
          onChange={async (e) => {
            const on = e.target.checked // read first: the box shows the saved value again meanwhile
            await saveSteamFollow(on)
            if (on) followSteam(true)
          }}
        />
      </SettingRow>
    </>
  )
}
