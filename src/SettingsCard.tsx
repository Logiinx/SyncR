import { useState } from 'react'
import InfoTip from './InfoTip'
import Spinner from './Spinner'

// The pieces of Settings

// After a window on top of Settings closed (a question, a warning): the focus back in Settings, so
// Escape closes it. `inside`: any element of the section.
export function focusSettings(inside: Element | null) {
  inside?.closest<HTMLElement>('[role="dialog"]')?.focus()
}

// One setting: its name (and a dim detail) on the left, its control on the right. `title`: a
// longer explanation on hover.
export function SettingRow({ label, value, title, className, children }: {
  label: React.ReactNode
  value?: string
  title?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`settings-row${className ? ` ${className}` : ''}`} title={title}>
      <span className="settings-row-label">
        {label}
        {value && <span className="setting-value"> {value}</span>}
      </span>
      <span className="settings-row-control">{children}</span>
    </div>
  )
}

// A module's on/off switch, the first row of its section (Mail, Video, Games, Hardware). What
// follows it sits in a `settings-part` fieldset, grayed while off.
export function ModuleSwitch({ name, about, aboutLabel, on, onChange }: {
  name: string
  about: string
  aboutLabel: string
  on: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <SettingRow
      label={
        <>
          {name}
          <InfoTip label={aboutLabel}>{about}</InfoTip>
        </>
      }
    >
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
    </SettingRow>
  )
}

// A connection's check under its row (the proxy, Steam, Google Calendar, Gmail): dim, green when
// it works, lined up with the control above (`under`: a field, or a button). One line, cut with …;
// the whole text on hover, or a tap shows it in full (a long error on the phone).
export function RowStatus({ ok, text, busy, under = 'field' }: {
  ok: boolean
  text: string
  busy?: boolean
  under?: 'field' | 'button'
}) {
  const [full, setFull] = useState(false)
  return (
    <p
      className={`settings-row-status under-${under}${ok ? ' ok' : ''}${full ? ' full' : ''}`}
      title={text}
      onClick={() => setFull(!full)}
    >
      {busy && <Spinner size={12} />}
      {text}
    </p>
  )
}
