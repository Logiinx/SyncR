import { useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { ModuleSwitch, SettingRow } from './SettingsCard'
import InfoTip from './InfoTip'
import ContextMenu from './ContextMenu'
import PopupBell from './PopupBell'
import { colorMenuItems } from './cardColors'
import { t } from './i18n'
import { setModuleOn, useModuleOn } from './modules'
import { forgetAccountMail, mailTurned } from './mailAlerts'
import { connectGmail, removeAccount, setAccountAlerts, setAccountColor, setAccountEnabled, useGmailAccounts } from './gmail'
import { loadProjectId, saveProjectId, useInstantStatus } from './instantMail'
import { loadSafeSenders, removeSafeSender, SAFE_SENDERS_KEY } from './safeSenders'
import { isComplete, useConnection } from './igdb'

// Settings → Mail (PC; in the browser only while developing): Mail on or off (modules.ts), the
// Gmail accounts, instant mail, safe senders. Sound, fading and dragging: Alerts → Emails.
export default function MailSection() {
  const on = useModuleOn('mail')
  return (
    <>
      <ModuleSwitch
        name={t('Mail')}
        aboutLabel={t('About the Mail module')}
        about={t('Your Gmail inboxes in a Mail tab, and new emails in the pop-up. Off: the tab closes and no mail is checked. This device only.')}
        on={on}
        onChange={(next) => {
          setModuleOn('mail', next)
          mailTurned(next)
        }}
      />
      <fieldset className="settings-part" disabled={!on}>
        <GmailPart />
        <SafeSenders />
      </fieldset>
    </>
  )
}

// Gmail accounts (gmail.ts). Each account: its color (the strip on its pop-ups), address, Remove,
// its bell (off: no pop-up or sound, its new mail shows as missed), on/off (off: no pop-ups, not
// in the Mail tab). "Add account…" opens Google's sign-in like
// Calendar's (needs the proxy too).
// Instant mail (instantMail.ts): the Google Cloud project ID, and a sign-in of the project's
// owner (one of the accounts) with the Pub/Sub permission.
function GmailPart() {
  const accounts = useGmailAccounts()
  const [projectId, setProjectId] = useState(loadProjectId)
  const instant = useInstantStatus()
  const collector = accounts.find((a) => a.pubsub && !a.expired)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const [colorMenu, setColorMenu] = useState<{ email: string; color: string; x: number; y: number } | null>(null)
  const proxy = useConnection()

  async function add(pubsub = false) {
    setBusy(true)
    setMessage(isTauri() ? { text: t('Finish the sign-in in your browser…'), ok: false } : null)
    try {
      setMessage(await connectGmail(pubsub)) // browser: leaves the app
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : String(error), ok: false })
    }
    setBusy(false)
  }

  const status = message?.text ??
    (!isComplete(proxy) ? t('Needs the game search proxy (Accounts)') : accounts.length === 0 ? t('No account yet') : null)
  return (
    <>
      <h4 className="settings-card-sub">
        Gmail
        <InfoTip label={t('About the checkboxes')}>
          {t("An account's checkbox turns it on or off. On: its mail shows in the Mail tab. The bell: its new emails pop up with a sound. Bell off: they show as missed in the Mail tab instead.")}
        </InfoTip>
      </h4>
      {accounts.map((account) => (
        <SettingRow
          key={account.email}
          className="gmail-account"
          label={
            <span className="gmail-account-name">
              {/* The account's color (its pop-ups' strip, its dot in the Mail tab): a click
                  opens the color list, like Board cards' "Card color" */}
              <button
                className="color-dot-button"
                title={t('Color')}
                aria-label={t('Color')}
                onClick={(e) => setColorMenu({ email: account.email, color: account.color, x: e.clientX, y: e.clientY })}
              >
                <span className="menu-swatch" style={{ background: `var(--text-${account.color})` }} />
              </button>
              <span className="gmail-account-email" title={account.email}>{account.email}</span>
              {account.expired && <span className="setting-value">{t('signed out')}</span>}
            </span>
          }
        >
          <button
            className="setting-button"
            onClick={() => {
              removeAccount(account.email)
              forgetAccountMail(account.email) // its stored emails go too (privacy page)
            }}
          >
            {t('Remove')}
          </button>
          <PopupBell
            on={account.alerts !== false}
            onChange={(on) => setAccountAlerts(account.email, on)}
            title={account.alerts !== false ? t('New emails in the pop-up: on') : t('New emails in the pop-up: off')}
            disabled={!account.enabled || account.expired}
          />
          {account.expired ? (
            // The instant mail account asks for the Pub/Sub permission again, or it would lose it
            <button className="setting-button" disabled={busy} onClick={() => add(account.pubsub)}>
              {t('Sign in…')}
            </button>
          ) : (
            <input
              type="checkbox"
              checked={account.enabled}
              aria-label={t('Emails from {email}', { email: account.email })}
              onChange={(e) => setAccountEnabled(account.email, e.target.checked)}
            />
          )}
        </SettingRow>
      ))}
      <SettingRow
        label={t('New emails in Primary')}
        status={status ? { ok: !!message?.ok, text: status, busy: busy && isTauri() } : null}
      >
        <button className="setting-button" disabled={busy || !isComplete(proxy)} onClick={() => add()}>
          {t('Add account…')}
        </button>
      </SettingRow>
      {colorMenu && (
        <ContextMenu
          x={colorMenu.x}
          y={colorMenu.y}
          onClose={() => setColorMenu(null)}
          header={{ title: t('Account color') }}
          items={colorMenuItems(colorMenu.color, (color) => color && setAccountColor(colorMenu.email, color), false)}
        />
      )}
      {accounts.length > 0 && (
        <>
          <h4 className="settings-card-sub">{t('Instant mail')}</h4>
          <SettingRow label={t('Google Cloud project ID')} className="settings-row-field">
            <input
              type="text"
              placeholder={t('e.g. syncr-123456')}
              aria-label={t('Google Cloud project ID')}
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value.trim())
                saveProjectId(e.target.value.trim())
              }}
              spellCheck={false}
            />
          </SettingRow>
          <SettingRow
            label={t('Pub/Sub permission')}
            value={collector?.email ?? t('not yet')}
            status={instant.text ? instant : null}
          >
            <button className="setting-button" disabled={busy || !isComplete(proxy)} onClick={() => add(true)}>
              {t('Sign in…')}
            </button>
          </SettingRow>
        </>
      )}
    </>
  )
}

// Safe senders (safeSenders.ts): their emails open with web images. Added from an email
// ("Always for …"), removed here. The list follows changes made meanwhile in the pop-up window.
function SafeSenders() {
  const [list, setList] = useState(loadSafeSenders)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === SAFE_SENDERS_KEY && setList(loadSafeSenders())
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  return (
    <>
      <h4 className="settings-card-sub">
        {t('Safe senders')}
        <InfoTip label={t('About safe senders')}>
          {t('Web images show by themselves in their emails. Add one from an email: "Always for …"')}
        </InfoTip>
      </h4>
      {list.map((entry) => (
        <SettingRow key={entry} label={<span className="gmail-account-email" title={entry}>{entry}</span>}>
          <button
            className="setting-button"
            onClick={() => {
              removeSafeSender(entry)
              setList(loadSafeSenders())
            }}
          >
            {t('Remove')}
          </button>
        </SettingRow>
      ))}
      {!list.length && <p className="settings-empty">{t('None yet. Add one from an email: "Always for …"')}</p>}
    </>
  )
}
