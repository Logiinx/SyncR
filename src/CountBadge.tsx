// How many new things (user's pick 7, 2026-11-23): a round blue bubble on a corner (switch
// buttons, tab icons), or the same blue as a pill after a name (sidebar). Capped so it stays small.
export function CountBadge({ count, title, max = 99, pill }: { count: number; title: string; max?: number; pill?: boolean }) {
  if (count <= 0) return null
  return (
    <span className={pill ? 'count-badge pill' : 'count-badge'} title={title}>
      {count > max ? `${max}+` : count}
    </span>
  )
}
