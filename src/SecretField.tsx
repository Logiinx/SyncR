import { useEffect, useRef, type RefObject } from 'react'
import { Eye, EyeOff } from 'lucide-react'

// A passphrase or PIN box with an eye that shows what's typed (PassphraseDialog, LockScreen).
// The eye is handled by the parent, so one eye can show a "Repeat" box below too.
// Edge's own reveal eye (the PC app's WebView2) is hidden here (index.css), or there'd be two.
function SecretField({
  value,
  onChange,
  placeholder,
  autoComplete,
  visible,
  onToggle,
  inputRef,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  autoComplete: string
  visible: boolean
  onToggle: () => void
  inputRef?: RefObject<HTMLInputElement | null>
}) {
  const ownRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? ownRef
  // Showing or hiding puts the cursor at the start (the browser, when the box's type changes): put it back
  const cursor = useRef<[number, number] | null>(null)
  // (a moment later: the browser moves it after the change, not during)
  useEffect(() => {
    const saved = cursor.current
    cursor.current = null
    if (!saved) return
    const timer = setTimeout(() => ref.current?.setSelectionRange(...saved))
    return () => clearTimeout(timer)
  }, [visible, ref])
  function toggle() {
    const input = ref.current
    if (input && document.activeElement === input) cursor.current = [input.selectionStart ?? 0, input.selectionEnd ?? 0]
    onToggle()
  }
  const what = placeholder.replace(/^[A-Z](?=[a-z])/, (letter) => letter.toLowerCase()) // "Passphrase" → "passphrase", "PIN" stays
  return (
    <div className="secret-field">
      <input
        ref={ref}
        type={visible ? 'text' : 'password'}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
      {/* mousedown prevented: typing goes on in the box. Skipped by Tab, which goes to the next box. */}
      <button type="button" className="eye" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={toggle} title={visible ? `Hide ${what}` : `Show ${what}`}>
        {visible ? <EyeOff size={16} strokeWidth={1.5} /> : <Eye size={16} strokeWidth={1.5} />}
      </button>
    </div>
  )
}

export default SecretField
