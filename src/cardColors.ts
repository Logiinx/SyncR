import type { MenuItem } from './ContextMenu'

// Background colors for Board cards and groups ("Color…" in their menu). A card stores the
// name; the tint comes from the same palette as text colors (--text-red…, index.css), so it
// follows palette changes. Synced with the card.
export const CARD_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'gray']

// The card's tint for its CSS (.card.colored / .card-group.colored)
export function tintStyle(color: string | undefined): React.CSSProperties | undefined {
  return color ? ({ '--tint': `var(--text-${color})` } as React.CSSProperties) : undefined
}

// The "Color…" list: Default, then the colors by name, the current one checked (null: none checked).
// withDefault false: the colors only (something that always has one, e.g. a Gmail account).
export function colorMenuItems(
  current: string | undefined | null,
  pick: (color: string | undefined) => void,
  withDefault = true,
): MenuItem[] {
  return [
    ...(withDefault
      ? [{ label: 'Default', swatch: 'var(--bg)', checked: current === undefined, onClick: () => pick(undefined) }]
      : []),
    ...CARD_COLORS.map((color, index) => ({
      label: color[0].toUpperCase() + color.slice(1),
      swatch: `var(--text-${color})`,
      checked: current === color,
      divider: withDefault && index === 0,
      onClick: () => pick(color),
    })),
  ]
}
