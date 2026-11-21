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
