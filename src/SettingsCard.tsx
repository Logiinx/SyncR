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
// longer explanation on hover. `status`: a button's connection state, a line under the name.
export function SettingRow({ label, value, title, className, status, children }: {
  label: React.ReactNode
  value?: string
  title?: string
  className?: string
  status?: { ok: boolean; text: string; busy?: boolean } | null
  children: React.ReactNode
}) {
  return (
    <div className={`settings-row${className ? ` ${className}` : ''}`} title={title} onClick={flipFromRow}>
      <span className="settings-row-label">
        {label}
        {value && <span className="setting-value"> {value}</span>}
        {status?.text && <RowStatus {...status} under="name" />}
      </span>
      <span className="settings-row-control">{children}</span>
    </div>
  )
}

// A row with one switch: a click anywhere on it flips the switch (user, 2026-11-23). Not on the
// row's other controls (a button, a link, the ⓘ, a status line), nor on what only belongs to the
// row in React (the ⓘ's tip is drawn elsewhere on the page), nor while text is selected. A grayed
// switch ignores the click by itself.
function flipFromRow(event: React.MouseEvent<HTMLDivElement>) {
  const row = event.currentTarget
  const target = event.target as Element
  if (!row.contains(target)) return
  if (target.closest('input, button, select, textarea, a, label, .info-tip, .settings-row-status')) return
  if (!window.getSelection()?.isCollapsed) return
  const switches = row.querySelectorAll<HTMLInputElement>('.settings-row-control > input[type="checkbox"]')
  if (switches.length === 1) switches[0].click()
}

// A module's on/off switch, the first row of its section (Mail, Video, Games, Hardware). What
// follows it sits in a `settings-part` fieldset, grayed while off. Search shows it with any of the
// module's results (SettingsSearch.tsx).
export function ModuleSwitch({ name, about, aboutLabel, on, onChange }: {
  name: string
  about: string
  aboutLabel: string
  on: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <SettingRow
      className="module-switch"
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

// A connection's check (the proxy, Steam, Google Calendar, Gmail): dim, green when it works.
// `under`: a field (its own line under the row, lined up with the field), or the name (inside the
// row, for a button: SettingRow's `status`). One line, cut with …; the whole text on hover, or a
// tap shows it in full (a long error on the phone).
export function RowStatus({ ok, text, busy, under = 'field' }: {
  ok: boolean
  text: string
  busy?: boolean
  under?: 'field' | 'name'
}) {
  const [full, setFull] = useState(false)
  const Tag = under === 'name' ? 'span' : 'p' // inside the name's <span>, a <p> isn't allowed
  return (
    <Tag
      className={`settings-row-status under-${under}${ok ? ' ok' : ''}${full ? ' full' : ''}`}
      title={text}
      onClick={() => setFull(!full)}
    >
      {busy && <Spinner size={12} />}
      {text}
    </Tag>
  )
}
