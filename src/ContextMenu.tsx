import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, ChevronRight, type LucideIcon } from 'lucide-react'
import { currentZoom } from './appearance'

export interface MenuItem {
  label: string
  icon?: LucideIcon // before the label
  danger?: boolean // red; put it last: it always gets the line above it
  divider?: boolean // a thin line above it (starts a new group of actions)
  section?: string // a small dim title above it, naming the group it starts (only when there are two to tell apart)
  swatch?: string // a small round color dot before the label (a CSS color)
  checked?: boolean // a ✓ after the label (the current choice)
  disabled?: boolean // grayed, can't be pressed
  hint?: string // tooltip
  keepFocus?: boolean // pressing it leaves the cursor where it is (e.g. in the text being edited)
  onClick?: () => void
  // A list of its own (e.g. Move to folder), with a › after the label: with a mouse it opens beside
  // the menu on hover (or a click); on a touch screen a tap shows it in the menu's place, under its title
  submenu?: { title: string; items: MenuItem[] }
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  header?: { title: string; subtitle?: string } // what was right-clicked (e.g. a mail), above a line
  alignRight?: boolean // x is where the menu ends, not where it starts (a menu under a button on the right)
  onClose: () => void
}

const EDGE = 8 // px kept free between the menu and the window's edge
const GAP = 2 // px between the menu and its side list
const SWITCH_AFTER = 120 // ms over another line before an open side list gives way (the mouse crossing it)
const hasMouse = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches

// Right-click menu (long press on a phone). Closes on any click elsewhere or Escape.
function ContextMenu({ x, y, items, header, alignRight, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // The side list open (the index of its line), or on a touch screen the list shown instead
  const [open, setOpen] = useState<number | null>(null)
  const [inPlace, setInPlace] = useState<MenuItem['submenu'] | null>(null)
  const switchTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => clearTimeout(switchTimer.current), [])

  // x / y are screen pixels (mouse position): keep the menu inside the window, from its real size
  // (again when it changes, e.g. to a color list), and convert to the zoomed page (app scaling)
  const box = useRef<HTMLDivElement>(null)
  const side = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const zoom = currentZoom()
    el.style.left = el.style.top = '0'
    const { width, height } = el.getBoundingClientRect()
    const left = alignRight ? x - width : x
    el.style.left = `${Math.max(EDGE, Math.min(left, window.innerWidth - width - EDGE)) / zoom}px`
    el.style.top = `${Math.max(EDGE, Math.min(y, window.innerHeight - height - EDGE)) / zoom}px`
    // The side list: right of the menu (left when there's no room), its first line level with the open line
    const list = side.current
    const line = open === null ? null : el.querySelector<HTMLElement>(`[data-line="${open}"]`)
    const first = list?.querySelector<HTMLElement>('button')
    if (!list || !line || !first) return
    list.style.left = list.style.top = '0'
    const menu = el.getBoundingClientRect()
    const size = list.getBoundingClientRect()
    const top = line.getBoundingClientRect().top - (first.getBoundingClientRect().top - size.top)
    const sideLeft = menu.right + GAP + size.width <= window.innerWidth - EDGE ? menu.right + GAP : menu.left - GAP - size.width
    list.style.left = `${Math.max(EDGE, sideLeft) / zoom}px`
    list.style.top = `${Math.max(EDGE, Math.min(top, window.innerHeight - size.height - EDGE)) / zoom}px`
  })

  // Hovering a line: a side list opens at once; another line takes over only after SWITCH_AFTER,
  // so crossing lines on the way to the open list doesn't close it
  function hover(index: number) {
    if (!hasMouse()) return
    clearTimeout(switchTimer.current)
    const wanted = items[index].submenu && !items[index].disabled ? index : null
    if (wanted === open) return
    if (open === null) setOpen(wanted)
    else switchTimer.current = window.setTimeout(() => setOpen(wanted), SWITCH_AFTER)
  }
  function choose(item: MenuItem) {
    if (item.submenu) {
      clearTimeout(switchTimer.current)
      if (hasMouse()) setOpen(items.indexOf(item))
      else setInPlace(item.submenu)
      return
    }
    onClose()
    item.onClick?.()
  }

  const shown = inPlace ? inPlace.items : items
  const shownHeader = inPlace ? { title: inPlace.title } : header
  const sideList = open !== null && !inPlace ? items[open]?.submenu : undefined
  // One menu's lines; main: the menu itself (its lines can open a side list)
  const lines = (list: MenuItem[], main: boolean) =>
    list.map((item, index) => (
      // Labels can repeat (two Board groups with the same name): the place makes it unique
      <Fragment key={`${index}:${item.label}`}>
        {(item.divider || item.danger) && index > 0 && <div className="context-menu-divider" />}
        {item.section && <div className="context-menu-section" title={item.section}>{item.section}</div>}
        <button
          className={[item.danger && 'danger', main && open === index && 'open'].filter(Boolean).join(' ')}
          data-line={main ? index : undefined}
          disabled={item.disabled}
          title={item.hint}
          onMouseDown={item.keepFocus ? (e) => e.preventDefault() : undefined}
          onMouseEnter={main ? () => hover(index) : undefined}
          onClick={() => choose(item)}
        >
          {item.icon && <item.icon size={15} className="menu-icon" />}
          {item.swatch && <span className="menu-swatch" style={{ background: item.swatch }} />}
          {item.label}
          {item.checked && <Check size={14} className="menu-check" />}
          {item.submenu && <ChevronRight size={14} className="menu-check" />}
        </button>
      </Fragment>
    ))

  return (
    <div
      className="menu-backdrop"
      onMouseDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div className="context-menu" ref={box} onMouseDown={(e) => e.stopPropagation()}>
        {shownHeader && (
          <>
            <div className="context-menu-header">
              <span className="context-menu-title" title={shownHeader.title}>{shownHeader.title}</span>
              {shownHeader.subtitle && <span className="context-menu-subtitle" title={shownHeader.subtitle}>{shownHeader.subtitle}</span>}
            </div>
            <div className="context-menu-divider" />
          </>
        )}
        {lines(shown, !inPlace)}
      </div>
      {sideList && (
        <div className="context-menu" ref={side} onMouseDown={(e) => e.stopPropagation()} onMouseEnter={() => clearTimeout(switchTimer.current)}>
          {lines(sideList.items, false)}
        </div>
      )}
    </div>
  )
}

export default ContextMenu
