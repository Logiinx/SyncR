import type { FormEvent, KeyboardEvent, ReactNode, Ref } from 'react'

// The frame of every window (Settings, game window, questions…): the dark backdrop (a click on
// it closes), the box (role "dialog", focusable so Escape works when it has the focus) and
// Escape closing it. The box gets `ref`, so a window can focus or scroll it. Game windows put
// the box in a row with what shows beside it (`inRow`, `beside`: the trailer panel).
function Window(props: {
  className: string // the box's classes ("dialog settings")
  label?: string
  onClose: () => void
  escapeCloses?: boolean // false while something on top handles Escape first (a menu)
  onKeyDown?: (event: KeyboardEvent) => void // more keys (Enter in a question)
  onSubmit?: (event: FormEvent) => void // the box is a form: Enter in a field submits
  inRow?: boolean
  beside?: ReactNode
  ref?: Ref<HTMLDivElement>
  children: ReactNode
}) {
  const boxProps = {
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
    <div {...boxProps} ref={props.ref}>{props.children}</div>
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
