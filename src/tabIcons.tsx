import { Bell, Gamepad2, Mail, Video } from 'lucide-react'

// The Games, Reminders, Mail and Video tabs' icons, in the tab bar and the sidebar. Each has its
// own color (--tab-<kind> in index.css), so the one you look for is found at a glance.
export type SpecialTab = 'games' | 'reminders' | 'mail' | 'video'

const ICONS = { games: Gamepad2, reminders: Bell, mail: Mail, video: Video }

export function SpecialIcon({ kind, size, className }: { kind: SpecialTab; size: number; className?: string }) {
  const Icon = ICONS[kind]
  return <Icon size={size} className={`special-icon icon-${kind}${className ? ' ' + className : ''}`} />
}
