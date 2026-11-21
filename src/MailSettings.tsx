import { ModuleSwitch } from './SettingsCard'
import { t } from './i18n'
import { setModuleOn, useModuleOn } from './modules'
import { mailTurned } from './mailAlerts'

// Settings → Mail (PC): Mail on or off (modules.ts)
export default function MailSection() {
  const on = useModuleOn('mail')
  return (
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
  )
}
