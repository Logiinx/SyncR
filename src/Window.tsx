import { useRef, type FormEvent, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { useBack } from './backStack'

// The frame of every window (Settings, game window, questions…): the dark backdrop (a click on
// it closes), the box (role "dialog", focusable so Escape works when it has the focus) and
// Escape or Back (phone gesture, mouse button: backStack.ts) closing it. The box gets `ref`, so a window can focus or scroll it. Game windows put
// the box in a row with what shows beside it (`inRow`, `beside`: the trailer panel). They sit
// 92px from the top, like every window, instead of the middle: their prices and times arrive after
// opening, and a centered window growing would jump up (user, 2026-11-21).
function Window(props: {
  className: string // the box's classes ("dialog settings")
  label?: string
  onClose: () => void
  escapeCloses?: boolean // false while something on top handles Escape first (a menu)
  onKeyDown?: (event: KeyboardEvent) => void // more keys (Enter in a question)
  onSubmit?: (event: FormEvent) => void // the box is a form: Enter in a field submits
  inRow?: boolean
  beside?: ReactNode
  ref?: Ref<HTMLElement> // the box, a <div> or (onSubmit) a <form>
  children: ReactNode
}) {
  const boxRef = useRef<HTMLElement | null>(null)
  useBack(props.onClose, true, boxRef)
  // The box to the window's `ref`, whether it's a <div> or a <form>
  const setBox = (box: HTMLElement | null) => {
    boxRef.current = box
    if (typeof props.ref === 'function') props.ref(box)
    else if (props.ref) props.ref.current = box
  }
  const boxProps = {
    ref: setBox,
    className: props.className,
    role: 'dialog',
    'aria-label': props.label,
    tabIndex: -1,
    onMouseDown: (event: React.MouseEvent) => event.stopPropagation(),
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === 'Escape' && props.escapeCloses !== false) props.onClose()
      props.onKeyDown?.(event)
    },
  }
  const box = props.onSubmit ? (
    <form {...boxProps} onSubmit={props.onSubmit}>{props.children}</form>
  ) : (
    <div {...boxProps}>{props.children}</div>
  )
  return (
    <div className="dialog-backdrop" onMouseDown={props.onClose}>
      {props.inRow ? (
        <div className="game-window">
          {box}
          {props.beside}
        </div>
      ) : (
        box
      )}
    </div>
  )
}

export default Window
