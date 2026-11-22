import { Bell } from 'lucide-react'

// The bell that turns something's pop-up cards on or off, one click: a Video follow's new videos
// (Follows window), a Gmail account's new emails (Settings → Mail). Dim and empty when off,
// filled yellow when on. title says what it does and whether it's on.
export default function PopupBell({ on, title, onChange, disabled }: {
  on: boolean
  title: string
  onChange: (on: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      className={on ? 'popup-bell on' : 'popup-bell'}
      onClick={() => onChange(!on)}
      title={title}
      aria-label={title}
      aria-pressed={on}
      disabled={disabled}
    >
      <Bell size={15} fill={on ? 'currentColor' : 'none'} />
    </button>
  )
}
