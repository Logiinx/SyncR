import { useEffect, useRef, useState } from 'react'
import { createPassphrase, hasPassphrase, MIN_PASSPHRASE_LENGTH, unlock } from './crypto'
import Spinner from './Spinner'

// Asks for the sync passphrase. First device: create it (typed twice). Other devices: enter it.
// Closing it without a passphrase is fine: sync just stays locked.
function PassphraseDialog({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'loading' | 'create' | 'unlock'>('loading')
  const [passphrase, setPassphrase] = useState('')
  const [repeat, setRepeat] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    hasPassphrase()
      .then((exists) => setMode(exists ? 'unlock' : 'create'))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  useEffect(() => {
    if (mode !== 'loading') inputRef.current?.focus()
  }, [mode])

  async function submit() {
    if (busy || mode === 'loading') return
    setError(null)
    if (mode === 'create') {
      if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
        setError(`Use at least ${MIN_PASSPHRASE_LENGTH} characters.`)
        return
      }
      if (passphrase !== repeat) {
        setError('The two passphrases are different.')
        return
      }
    }
    setBusy(true)
    try {
      if (mode === 'create') await createPassphrase(passphrase)
      else if (!(await unlock(passphrase))) {
        setError('Wrong passphrase.')
        setBusy(false)
        inputRef.current?.select()
        return
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const type = visible ? 'text' : 'password'

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <form
        className="dialog"
        role="dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <h2>{mode === 'create' ? 'Create a passphrase' : 'Enter your passphrase'}</h2>
        {mode === 'loading' && !error && (
          <p className="loading-line">
            <Spinner /> Checking Dropbox…
          </p>
        )}
        {mode === 'create' && (
          <p>
            Your notes are encrypted with it before they go to Dropbox. You'll enter it once on each device.
            If you forget it, the copies in Dropbox can't be read. Your notes on each device are still fine.
          </p>
        )}
        {mode === 'unlock' && <p>The passphrase you created on your other device.</p>}

        {mode !== 'loading' && (
          <>
            <div className="passphrase-field">
              <input
                ref={inputRef}
                type={type}
                value={passphrase}
                placeholder="Passphrase"
                autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
                onChange={(e) => setPassphrase(e.target.value)}
              />
              <button
                type="button"
                className="eye"
                onClick={() => setVisible(!visible)}
                title={visible ? 'Hide passphrase' : 'Show passphrase'}
              >
                <svg viewBox="0 0 16 16">
                  <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
                  <circle cx="8" cy="8" r="2" />
                  {visible && <path d="M2 14L14 2" />}
                </svg>
              </button>
            </div>
            {mode === 'create' && (
              <input
                type={type}
                value={repeat}
                placeholder="Repeat passphrase"
                autoComplete="new-password"
                onChange={(e) => setRepeat(e.target.value)}
              />
            )}
          </>
        )}

        {error && <p className="dialog-error">{error}</p>}

        <div className="dialog-buttons">
          <button type="button" onClick={onClose}>
            Not now
          </button>
          <button type="submit" className="primary" disabled={busy || mode === 'loading'}>
            {busy ? 'Working…' : mode === 'create' ? 'Create' : 'Unlock'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default PassphraseDialog
