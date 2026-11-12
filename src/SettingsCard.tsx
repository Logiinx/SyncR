import type { LucideIcon } from 'lucide-react'

// The pieces of Settings and the Video settings window

// A card of settings: icon + title, then its rows
export function SettingsCard({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <section className="settings-card">
      <h3 className="settings-card-title">
        <Icon size={15} /> {title}
      </h3>
      {children}
    </section>
  )
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
