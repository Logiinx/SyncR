import { useEffect, useRef, useState } from 'react'

export interface DialogRequest {
  title: string
  message?: string
  input?: { initial: string; placeholder: string } // shows a text field (for rename)
  confirmLabel: string
  danger?: boolean // red confirm button (for delete)
  noCancel?: boolean // just a message with an OK button
  onConfirm: (value: string) => void
}

// A small centered box. Enter confirms, Escape or clicking outside cancels.
function Dialog({ request, onClose }: { request: DialogRequest; onClose: () => void }) {
  const [value, setValue] = useState(request.input?.initial ?? '')
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
    request.onConfirm(value)
    onClose()
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        className="dialog"
        role="dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
          // In the text field, Enter confirms. On buttons, Enter just presses the focused button.
          if (e.key === 'Enter' && e.target === inputRef.current) confirm()
        }}
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
      </div>
    </div>
  )
}

export default Dialog
