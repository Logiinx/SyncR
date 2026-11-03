import { useEffect, useRef, useState } from 'react'
import Window from './Window'
import SecretField from './SecretField'
import { changePin, checkPin, MIN_PIN_LENGTH, turnPinOff, turnPinOn } from './pinLock'

// Settings → App → PIN lock (pinLock.ts): turn it on (new PIN twice), change it (current PIN,
// then the new one twice), turn it off (current PIN). Opened in place of Settings, back after.
// Turning on doesn't lock now: the PIN is asked at the next start.

export type PinDialogMode = 'on' | 'change' | 'off'

const TEXT = {
  on: { title: 'Turn on the PIN lock', button: 'Turn on', busy: 'Turning on…' },
  change: { title: 'Change your PIN', button: 'Change', busy: 'Changing…' },
  off: { title: 'Turn off the PIN lock', button: 'Turn off', busy: 'Turning off…' },
}

function PinDialog({ mode, onClose }: { mode: PinDialogMode; onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [pin, setPin] = useState('')
  const [repeat, setRepeat] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const firstRef = useRef<HTMLInputElement>(null)
  const asksCurrent = mode !== 'on'
  const asksNew = mode !== 'off'

  useEffect(() => firstRef.current?.focus(), [])

  async function submit() {
    if (busy) return
    setError(null)
    if (asksCurrent && !current) return firstRef.current?.focus()
    if (asksNew && pin.length < MIN_PIN_LENGTH) return setError(`Use at least ${MIN_PIN_LENGTH} characters`)
    if (asksNew && pin !== repeat) return setError('The two PINs are different')
    setBusy(true)
    try {
      if (asksCurrent && !(await checkPin(current))) {
        setBusy(false)
        setCurrent('')
        setError('Wrong PIN')
        return firstRef.current?.focus()
      }
      if (mode === 'on') await turnPinOn(pin)
      else if (mode === 'change') await changePin(pin)
      else await turnPinOff()
      onClose()
    } catch (e) {
      setBusy(false)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Window
      className="dialog"
      label={TEXT[mode].title}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <h2>{TEXT[mode].title}</h2>
      {mode === 'on' && <p>SyncR will ask for it at every start. Forgot it? Your sync passphrase opens your notes too.</p>}
      {mode === 'off' && <p>SyncR will open without a PIN. Your notes stay encrypted on this PC.</p>}
      {asksCurrent && (
        <SecretField
          inputRef={firstRef}
          value={current}
          onChange={setCurrent}
          placeholder="Current PIN"
          autoComplete="current-password"
          visible={showCurrent}
          onToggle={() => setShowCurrent(!showCurrent)}
        />
      )}
      {asksNew && (
        <>
          <SecretField
            inputRef={asksCurrent ? undefined : firstRef}
            value={pin}
            onChange={setPin}
            placeholder="New PIN"
            autoComplete="new-password"
            visible={showNew}
            onToggle={() => setShowNew(!showNew)}
          />
          <input
            type={showNew ? 'text' : 'password'}
            value={repeat}
            placeholder="Repeat PIN"
            autoComplete="new-password"
            spellCheck={false}
            onChange={(e) => setRepeat(e.target.value)}
          />
        </>
      )}

      {error && <p className="dialog-error">{error}</p>}

      <div className="dialog-buttons">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? TEXT[mode].busy : TEXT[mode].button}
        </button>
      </div>
    </Window>
  )
}

export default PinDialog
