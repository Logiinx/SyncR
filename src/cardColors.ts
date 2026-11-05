import type { MenuItem } from './ContextMenu'
import { t, textKey } from './i18n'

// The fixed palette. Notes store "var(--text-red)" etc., not the color itself, so the
// colors can be tuned later in index.css and every note follows.
export const COLORS = [
  { id: 'red', name: textKey('Red') },
  { id: 'orange', name: textKey('Orange') },
  { id: 'yellow', name: textKey('Yellow') },
  { id: 'green', name: textKey('Green') },
  { id: 'blue', name: textKey('Blue') },
  { id: 'purple', name: textKey('Purple') },
  { id: 'pink', name: textKey('Pink') },
  { id: 'gray', name: textKey('Gray') },
]

// Background colors for Board cards and groups ("Card color…" / "Group color…" in their menu). A card stores the
// name; the tint comes from the same palette as text colors (--text-red…, index.css), so it
// follows palette changes. Synced with the card.

// The card's tint for its CSS (.card.colored / .card-group.colored)
export function tintStyle(color: string | undefined): React.CSSProperties | undefined {
  return color ? ({ '--tint': `var(--text-${color})` } as React.CSSProperties) : undefined
}

// The color list: Default, then the colors by name, the current one checked (null: none checked).
// withDefault false: the colors only (something that always has one, e.g. a Gmail account).
export function colorMenuItems(
  current: string | undefined | null,
  pick: (color: string | undefined) => void,
  withDefault = true,
): MenuItem[] {
  return [
    ...(withDefault
      ? [{ label: t('Default'), swatch: 'var(--bg)', checked: current === undefined, onClick: () => pick(undefined) }]
      : []),
    ...COLORS.map(({ id: color, name }, index) => ({
      label: t(name),
      swatch: `var(--text-${color})`,
      checked: current === color,
      divider: withDefault && index === 0,
      onClick: () => pick(color),
    })),
  ]
}
