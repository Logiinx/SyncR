import { useEffect, useRef, useState } from 'react'
import Window from './Window'

export interface DialogRequest {
  title: string
  message?: string
  input?: { initial: string; placeholder: string } // shows a text field (for rename)
  checkbox?: string // shows a checkbox with this label, unticked (e.g. "Delete its cards too")
  confirmLabel: string
  danger?: boolean // red confirm button (for delete)
  noCancel?: boolean // just a message with an OK button
  onConfirm: (value: string, checked: boolean) => void
}

// A small centered box. Enter confirms, Escape or clicking outside cancels.
function Dialog({ request, onClose }: { request: DialogRequest; onClose: () => void }) {
  const [value, setValue] = useState(request.input?.initial ?? '')
  const [checked, setChecked] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (request.input) inputRef.current?.select()
    // For dangerous actions, Enter should NOT confirm by accident
    else if (request.danger) cancelRef.current?.focus()
    else confirmRef.current?.focus()
  }, [request])

  function confirm() {
    request.onConfirm(value, checked)
    onClose()
  }

  return (
    <Window
      className="dialog"
      label={request.title}
      onClose={onClose}
      // In the text field, Enter confirms. On buttons, Enter just presses the focused button.
      onKeyDown={(e) => e.key === 'Enter' && e.target === inputRef.current && confirm()}
    >
      <h2>{request.title}</h2>
      {request.message && <p>{request.message}</p>}
      {request.input && (
        <input
          ref={inputRef}
          value={value}
          placeholder={request.input.placeholder}
          onChange={(e) => setValue(e.target.value)}
        />
      )}
      {request.checkbox && (
        <label className="dialog-check">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          {request.checkbox}
        </label>
      )}
      <div className="dialog-buttons">
        {!request.noCancel && (
          <button ref={cancelRef} onClick={onClose}>
            Cancel
          </button>
        )}
        <button ref={confirmRef} className={request.danger ? 'danger' : 'primary'} onClick={confirm}>
          {request.confirmLabel}
        </button>
      </div>
    </Window>
  )
}

export default Dialog
